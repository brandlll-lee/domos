import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  spawn: vi.fn(),
  list: vi.fn(),
  connect: vi.fn(),
  cliError: false,
}));
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = mocks.connect;
    close = async () => {};
    callTool = mocks.call;
    listTools = mocks.list;
  },
}));
vi.mock("node:child_process", () => ({
  spawn: mocks.spawn,
  execFile: vi.fn(),
}));
vi.mock("../src/harness/browser-view.mjs", () => ({
  openBrowserView: (
    _run: unknown,
    _call: unknown,
    _signal: unknown,
    _ready: unknown,
    input: unknown,
  ) => ({ input }),
}));
const entry = "../src/harness/browser-service.mjs";
const { openBrowserService } = await import(entry);
const policyEntry = "../src/harness/browser-tools.mjs";
const { browserTool, browserResult } = await import(policyEntry);
const baseline = JSON.parse(
  await readFile(
    new URL("./fixtures/browser-failures.json", import.meta.url),
    "utf8",
  ),
);
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const clean of cleanups.splice(0)) await clean();
  vi.clearAllMocks();
  mocks.cliError = false;
});
const success = () => ({
  content: [{ type: "text", text: "done" }],
  isError: false,
});

async function setup() {
  mocks.list.mockResolvedValue({
    tools: ["click", "get_url", "screenshot", "eval"].map((name) => ({
      name: `agent_browser_${name}`,
      description: name,
      inputSchema: {
        type: "object",
        properties: {
          session: { type: "string" },
          extraArgs: { type: "array" },
          selector: { type: "string" },
          script: { type: "string" },
        },
      },
    })),
  });
  mocks.call.mockImplementation(async () => success());
  mocks.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: Object.assign(new EventEmitter(), { destroy() {} }),
      stderr: Object.assign(new EventEmitter(), { destroy() {} }),
    });
    queueMicrotask(() => {
      child.stdout.emit(
        "data",
        JSON.stringify({ success: true, data: { url: "http://fixture/" } }),
      );
      child.emit("exit", mocks.cliError ? 1 : 0);
    });
    return child;
  });
  const directory = await mkdtemp(join(tmpdir(), "domos-browser-unit-"));
  const service = await openBrowserService(directory, directory);
  cleanups.push(async () => {
    await service.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  });
  return Object.assign(service, { directory });
}

test("cancellation drains dispatched work and prevents queued work", async () => {
  const service = await setup();
  const started = Promise.withResolvers<void>();
  const done = Promise.withResolvers<ReturnType<typeof success>>();
  mocks.call.mockImplementationOnce(() => {
    started.resolve();
    return done.promise;
  });
  const controller = new AbortController();
  const first = service.call("agent_browser_click", {}, controller.signal);
  await started.promise;
  const queued = service.call("agent_browser_click", {}, controller.signal);
  const rejected = expect(queued).rejects.toThrow();
  controller.abort();
  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(mocks.call.mock.calls[0]?.[2]).not.toHaveProperty("signal");
  let drained = false;
  void first.then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(drained).toBe(false);
  done.resolve(success());
  expect(await first).toMatchObject({ isError: false });
  await rejected;
  expect(mocks.call).toHaveBeenCalledTimes(1);
  await service.settle();
});

test("catalog cleanup does not launch a browser to close it", async () => {
  const service = await setup();
  await service.catalog();
  await service.close();
  expect(mocks.spawn).not.toHaveBeenCalled();
});

test("restart waits for the closing daemon before reconnecting", async () => {
  const service = await setup();
  await service.prepare(new AbortController().signal);
  const env = mocks.spawn.mock.calls[0]?.[2].env;
  const pidFile = join(
    env.AGENT_BROWSER_SOCKET_DIR,
    `${env.AGENT_BROWSER_SESSION}.pid`,
  );
  await writeFile(pidFile, "987654");
  let alive = true;
  const checked = Promise.withResolvers<void>();
  const kill = vi.spyOn(process, "kill").mockImplementation(() => {
    checked.resolve();
    if (!alive) throw Object.assign(new Error("Exited"), { code: "ESRCH" });
    return true;
  });
  try {
    const restarting = service.call(
      "agent_browser_restart",
      {},
      new AbortController().signal,
    );
    await checked.promise;
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    alive = false;
    await restarting;
    expect(mocks.connect).toHaveBeenCalledTimes(2);
  } finally {
    kill.mockRestore();
    await rm(pidFile, { force: true });
  }
});

test.each(["native", "transport", "cdp"])(
  "%s unknown outcome holds mutations and takeover until explicit restart",
  async (mode) => {
    const service = await setup();
    if (mode === "native")
      mocks.call.mockResolvedValueOnce(baseline.lostResponse);
    else if (mode === "cdp")
      mocks.call.mockResolvedValueOnce({
        content: [
          { type: "text", text: "CDP command timed out: Runtime.evaluate" },
        ],
        isError: true,
        structuredContent: {
          response: { error: "CDP command timed out: Runtime.evaluate" },
        },
      });
    else mocks.call.mockRejectedValueOnce(new Error("Transport lost"));
    await service
      .call("agent_browser_click", {}, new AbortController().signal)
      .catch(() => {});
    await expect(
      service.call("agent_browser_click", {}, new AbortController().signal),
    ).rejects.toThrow("结果未知");
    await expect(service.settle()).rejects.toThrow("结果未知");
    expect(mocks.call).toHaveBeenCalledTimes(1);
    await service.call(
      "agent_browser_get_url",
      {},
      new AbortController().signal,
    );
    await expect(service.settle()).rejects.toThrow("结果未知");
    await service.call(
      "agent_browser_restart",
      {},
      new AbortController().signal,
    );
    await service.settle();
    await service.call("agent_browser_click", {}, new AbortController().signal);
  },
);

test("a new worker retains an interrupted browser until explicit restart", async () => {
  const service = await setup();
  mocks.call.mockResolvedValueOnce(baseline.lostResponse);
  await service.call("agent_browser_click", {}, new AbortController().signal);
  await service.close();
  const restored = await openBrowserService(
    service.directory,
    service.directory,
  );
  cleanups.unshift(() => restored.close());
  await expect(
    restored.call("agent_browser_click", {}, new AbortController().signal),
  ).rejects.toThrow("结果未知");
  await restored.call(
    "agent_browser_restart",
    {},
    new AbortController().signal,
  );
  await restored.settle();
});

test("viewer input waits for native replies and retains unknown delivery", async () => {
  const service = await setup();
  const view = await service.view(new AbortController().signal);
  await view.input(
    [["keyboard", "type", "Draft"]],
    new AbortController().signal,
  );
  await service.settle();
  mocks.cliError = true;
  await expect(
    view.input([["mouse", "move", "10", "20"]], new AbortController().signal),
  ).rejects.toThrow("结果未知");
  await expect(service.settle()).rejects.toThrow("结果未知");
  mocks.cliError = false;
  await service.call("agent_browser_restart", {}, new AbortController().signal);
  await service.settle();
});

test("runtime parameters are hidden and rejected at execution", async () => {
  const service = await setup();
  expect(JSON.stringify(await service.catalog())).not.toContain('"extraArgs"');
  await expect(
    service.call(
      "agent_browser_click",
      { session: "other" },
      new AbortController().signal,
    ),
  ).rejects.toThrow("No action was sent");
  await expect(
    service.call(
      "agent_browser_click",
      { invented: 1 },
      new AbortController().signal,
    ),
  ).rejects.toThrow("No action was sent");
  expect(mocks.call).not.toHaveBeenCalled();
  const tool = browserTool({
    inputSchema: {
      properties: { session: {}, selector: {} },
      required: ["session", "selector"],
    },
  });
  expect(tool.inputSchema.required).toEqual(["selector"]);
});

test("capture metadata failure retains native action output and bounds text", async () => {
  const service = await setup();
  mocks.cliError = true;
  mocks.call.mockResolvedValueOnce({
    content: [{ type: "image", data: "fixture", mimeType: "image/png" }],
    structuredContent: { native: "delivered" },
  });
  const result = await service.call(
    "agent_browser_screenshot",
    {},
    new AbortController().signal,
  );
  expect(result.structuredContent).toEqual({ native: "delivered" });
  expect(result.content).toContainEqual(
    expect.objectContaining({ type: "image", data: "fixture" }),
  );
  expect(JSON.stringify(result.content)).toContain("lookup failed");
  const bounded = browserResult({
    content: [{ type: "text", text: "a".repeat(50000) }],
    structuredContent: { native: "kept" },
  });
  expect(bounded.content[0].text.length).toBeLessThan(32200);
  expect(bounded.structuredContent).toEqual({ native: "kept" });
});
