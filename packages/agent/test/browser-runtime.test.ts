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
  command: vi.fn(),
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
  openBrowserView: async (
    _run: unknown,
    _signal: unknown,
    _ready: unknown,
    input: unknown,
  ) => ({ input }),
}));
vi.mock("../src/harness/browser-command.mjs", () => ({
  browserCommand: mocks.command,
}));
const entry = "../src/harness/browser-service.mjs";
const { openBrowserService } = await import(entry);
const policyEntry = "../src/harness/browser-tools.mjs";
const { browserTool, browserResult, browserAccess } = await import(policyEntry);
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
    tools: [
      "open",
      "click",
      "fill",
      "type",
      "press",
      "snapshot",
      "get_url",
      "screenshot",
      "eval",
      "batch",
      "upload",
      "download",
      "hover",
      "install",
    ].map((name) => ({
      name: `agent_browser_${name}`,
      description: name,
      inputSchema: {
        type: "object",
        properties: {
          session: { type: "string" },
          extraArgs: { type: "array" },
          selector: { type: "string" },
          script: { type: "string" },
          url: { type: "string" },
          text: { type: "string" },
          key: { type: "string" },
          compact: { type: "boolean" },
          commands: { type: "array" },
          bail: { type: "boolean" },
          paths: { type: "array" },
          path: { type: "string" },
        },
      },
    })),
  });
  mocks.call.mockImplementation(async () => success());
  mocks.command.mockImplementation(async () => {
    if (mocks.cliError) throw new Error("native response lost");
    return {};
  });
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

test.each([
  { name: "agent_browser_click", args: {} },
  { name: "agent_browser_batch", args: { commands: [["click", "#ok"]] } },
])(
  "cancellation drains dispatched $name and prevents queued work",
  async ({ name, args }) => {
    const service = await setup();
    const started = Promise.withResolvers<void>();
    const done = Promise.withResolvers<ReturnType<typeof success>>();
    mocks.call.mockImplementationOnce(() => {
      started.resolve();
      return done.promise;
    });
    const controller = new AbortController();
    const first = service.call(name, args, controller.signal);
    await started.promise;
    const queued = service.call(name, args, controller.signal);
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
  },
);

function pageFacts(text = "Ready") {
  return {
    content: [{ type: "text", text: "page facts" }],
    structuredContent: {
      response: {
        success: true,
        data: {
          result: {
            url: "http://fixture/",
            title: "Fixture",
            readyState: "complete",
            text,
            controls: [],
          },
        },
      },
    },
  };
}

test("navigation preserves native output and leaves observation to the Agent", async () => {
  const service = await setup();
  const native = {
    content: [{ type: "text", text: "Navigation accepted" }],
    structuredContent: {
      response: { success: true, data: { url: "http://fixture/" } },
    },
  };
  mocks.call.mockImplementation(async ({ name }) =>
    name === "agent_browser_open"
      ? native
      : name === "agent_browser_eval"
        ? pageFacts()
        : { content: [{ type: "text", text: "@e1 button Ready" }] },
  );
  const result = await service.call(
    "agent_browser_open",
    { url: "http://fixture/" },
    new AbortController().signal,
  );
  expect(result.structuredContent).toEqual(native.structuredContent);
  expect(JSON.stringify(result.content)).not.toContain("Fresh page facts");
  const timing = result.content.find((part: { text?: string }) =>
    part.text?.startsWith("Domos browser timing"),
  );
  expect(timing.text).toMatch(
    /queueMs.*commandMs.*observationMs.*metadataMs.*totalMs/,
  );
  const calls = mocks.call.mock.calls.map(([request]) => request);
  expect(calls.map((call) => call.name)).toEqual(["agent_browser_open"]);
  expect(calls[0].arguments).not.toHaveProperty("extraArgs");
  expect(calls[0].arguments).not.toHaveProperty("all");
});

test("large page facts leave room for fresh element refs", async () => {
  const service = await setup();
  mocks.call.mockImplementation(async ({ name }) =>
    name === "agent_browser_open"
      ? success()
      : name === "agent_browser_eval"
        ? pageFacts("x".repeat(40000))
        : { content: [{ type: "text", text: "@e1 button Confirm" }] },
  );
  const result = await service.call(
    "agent_browser_observe",
    {},
    new AbortController().signal,
  );
  expect(JSON.stringify(result.content)).toContain("@e1 button Confirm");
  expect(JSON.stringify(result.content)).toContain("Page facts truncated");
});

test("failed observation preserves successful navigation and never repeats it", async () => {
  const service = await setup();
  mocks.call.mockImplementation(async ({ name }) =>
    name === "agent_browser_open"
      ? success()
      : { isError: true, content: [{ type: "text", text: "read failed" }] },
  );
  const result = await service.call(
    "agent_browser_open",
    { url: "http://fixture/" },
    new AbortController().signal,
  );
  expect(result.isError).toBe(false);
  const observed = await service.call(
    "agent_browser_observe",
    {},
    new AbortController().signal,
  );
  expect(observed.isError).toBe(true);
  expect(JSON.stringify(observed.content)).toContain(
    "observation is incomplete",
  );
  expect(
    mocks.call.mock.calls.filter(
      ([call]) => call.name === "agent_browser_open",
    ),
  ).toHaveLength(1);
});

test.each(["", "Loading…", "Service unavailable"])(
  "observation reports actual text %j without inventing a cause",
  async (text) => {
    const service = await setup();
    mocks.call.mockImplementation(async ({ name }) =>
      name === "agent_browser_eval" ? pageFacts(text) : success(),
    );
    const result = await service.call(
      "agent_browser_observe",
      {},
      new AbortController().signal,
    );
    expect(JSON.stringify(result.content)).toContain(
      JSON.stringify({
        url: "http://fixture/",
        title: "Fixture",
        readyState: "complete",
        text,
        controls: [],
      }).replaceAll('"', '\\"'),
    );
    expect(JSON.stringify(result.content)).toContain("alone does not explain");
  },
);

test("native batches preserve command order, options and partial results", async () => {
  const service = await setup();
  const native = {
    ...success(),
    structuredContent: {
      response: {
        success: true,
        data: [
          { success: true, data: {} },
          { success: false, error: "target missing" },
        ],
      },
    },
  };
  mocks.call.mockResolvedValueOnce(native);
  const args = {
    commands: [
      ["fill", "#draft", "Hello"],
      ["click", "#confirm"],
    ],
    bail: true,
  };
  const result = await service.call(
    "agent_browser_batch",
    args,
    new AbortController().signal,
  );
  expect(result.structuredContent).toEqual(native.structuredContent);
  expect(mocks.call).toHaveBeenCalledTimes(1);
  expect(mocks.call.mock.calls[0]?.[0]).toMatchObject({
    name: "agent_browser_batch",
    arguments: args,
  });
});

test.each([
  [["click", "#ok"], ["install"]],
  [
    ["click", "#ok"],
    ["open", "https://example.com", "--session", "another-bot"],
  ],
  [["batch", "click #ok"]],
])(
  "batch validation rejects runtime and maintenance commands before dispatch: %j",
  async (...commands) => {
    const service = await setup();
    await expect(
      service.call(
        "agent_browser_batch",
        { commands },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(mocks.call).not.toHaveBeenCalled();
  },
);

test("a lost batch response blocks further mutations", async () => {
  const service = await setup();
  mocks.call.mockRejectedValueOnce(new Error("response lost"));
  await expect(
    service.call(
      "agent_browser_batch",
      { commands: [["click", "#ok"]] },
      new AbortController().signal,
    ),
  ).rejects.toThrow();
  await expect(service.settle()).rejects.toThrow("结果未知");
  expect(mocks.call).toHaveBeenCalledTimes(1);
});

test.each(["outcome_unknown", "page_wedged"])(
  "native batch %s holds further mutations",
  async (code) => {
    const service = await setup();
    mocks.call.mockResolvedValueOnce({
      isError: true,
      content: [{ type: "text", text: "Native batch stopped" }],
      structuredContent: { response: [{ success: false, code }] },
    });
    const result = await service.call(
      "agent_browser_batch",
      { commands: [["click", "#ok"]] },
      new AbortController().signal,
    );
    expect(result.structuredContent.response[0].code).toBe(code);
    await expect(service.settle()).rejects.toThrow("结果未知");
    await expect(
      service.call("agent_browser_click", {}, new AbortController().signal),
    ).rejects.toThrow("结果未知");
    expect(mocks.call).toHaveBeenCalledTimes(1);
  },
);

test("the Agent can repeat known actions and choose when to observe", async () => {
  const service = await setup();
  mocks.call.mockImplementation(async ({ name }) =>
    name === "agent_browser_eval" ? pageFacts() : success(),
  );
  const click = () =>
    service.call(
      "agent_browser_click",
      { selector: "#button" },
      new AbortController().signal,
    );
  for (let attempt = 0; attempt < 4; attempt++)
    expect((await click()).isError).toBe(false);
  expect(mocks.call.mock.calls.map(([call]) => call.name)).toEqual(
    Array(4).fill("agent_browser_click"),
  );
  await service.call("agent_browser_observe", {}, new AbortController().signal);
  expect(mocks.call.mock.calls.slice(4).map(([call]) => call.name)).toEqual([
    "agent_browser_eval",
    "agent_browser_snapshot",
  ]);
});

test("catalog cleanup does not launch a browser to close it", async () => {
  const service = await setup();
  await service.catalog();
  await service.close();
  expect(mocks.spawn).not.toHaveBeenCalled();
});

test("preparation preserves a headed page when viewport resizing fails", async () => {
  const service = await setup();
  mocks.spawn.mockImplementation((_command, args) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: Object.assign(new EventEmitter(), { destroy() {} }),
      stderr: Object.assign(new EventEmitter(), { destroy() {} }),
    });
    queueMicrotask(() => {
      const response = args.includes("viewport")
        ? baseline.viewportPreparation.response
        : baseline.viewportPreparation.pageRead;
      child.stdout.emit("data", JSON.stringify(response));
      child.emit("exit", response.success ? 0 : 1);
    });
    return child;
  });
  expect(await service.mode("headed", AbortSignal.timeout(5000))).toMatchObject(
    {
      available: true,
      mode: "headed",
    },
  );
  expect(await service.prepare(AbortSignal.timeout(5000))).toMatchObject({
    available: true,
    mode: "headed",
  });
  expect(
    mocks.spawn.mock.calls.some(([, args]) => args.includes("viewport")),
  ).toBe(false);
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

test("mode changes retain the profile and persist across worker starts", async () => {
  const service = await setup();
  const initial = JSON.parse(
    await readFile(join(service.directory, ".domos/browser.json"), "utf8"),
  );
  await service.mode("headed", new AbortController().signal);
  expect(await service.prepare(new AbortController().signal)).toMatchObject({
    mode: "headed",
    sharedDesktop: true,
  });
  const settings = JSON.parse(
    await readFile(join(service.directory, ".domos/browser.json"), "utf8"),
  );
  expect(settings).toMatchObject({ profile: initial.profile, headed: true });
  await service.close();
  const restored = await openBrowserService(
    service.directory,
    service.directory,
  );
  try {
    expect(await restored.prepare(new AbortController().signal)).toMatchObject({
      mode: "headed",
      sharedDesktop: true,
    });
    await restored.mode("headless", new AbortController().signal);
    expect(await restored.prepare(new AbortController().signal)).toMatchObject({
      mode: "headless",
      sharedDesktop: false,
    });
  } finally {
    await restored.close();
  }
});

test("a failed headed launch reports its saved mode and permits a confirmed recovery", async () => {
  const service = await setup();
  mocks.cliError = true;
  expect(
    await service.mode("headed", new AbortController().signal),
  ).toMatchObject({ available: false, mode: "headed" });
  expect(await service.prepare(AbortSignal.timeout(5000))).toMatchObject({
    available: false,
    mode: "headed",
  });
  await expect(service.settle()).rejects.toThrow("结果未知");
  mocks.cliError = false;
  expect(
    await service.mode("headless", new AbortController().signal),
  ).toMatchObject({ available: true, mode: "headless" });
  await service.settle();
});

test("a saved browser mode remains available when preparation fails after restart", async () => {
  const service = await setup();
  await service.mode("headed", new AbortController().signal);
  await service.close();
  const restored = await openBrowserService(
    service.directory,
    service.directory,
  );
  try {
    mocks.cliError = true;
    expect(await restored.prepare(new AbortController().signal)).toMatchObject({
      available: false,
      mode: "headed",
      sharedDesktop: true,
    });
    mocks.cliError = false;
    expect(
      await restored.mode("headless", new AbortController().signal),
    ).toMatchObject({
      available: true,
      mode: "headless",
    });
  } finally {
    await restored.close();
  }
});

test.each([
  [{ httpStatus: 403 }, "HTTP ERROR 403", "access_denied"],
  [{ httpStatus: 401 }, "HTTP ERROR 401", "authentication_required"],
  [{ challengePresent: true }, "", "verification_required"],
  [{ passwordFieldPresent: true }, "", "sign_in_form_present"],
  [null, "net::ERR_NAME_NOT_RESOLVED", "network_error"],
  [null, "Navigation failed", "unconfirmed_failure"],
])(
  "access evidence distinguishes observed failures: %s",
  (page, error, assessment) => {
    const evidence = browserAccess(
      page,
      { isError: Boolean(error), content: [{ type: "text", text: error }] },
      "https://fixture.test/",
      "headless",
    );
    expect(evidence).toContain(`"assessment":"${assessment}"`);
    expect(evidence).toContain('"requestedUrl":"https://fixture.test/"');
    expect(evidence).toContain("does not identify its cause");
  },
);

test("failed navigation preserves native failure for explicit recovery", async () => {
  const service = await setup();
  const failure = {
    isError: true,
    content: [{ type: "text", text: "HTTP ERROR 403" }],
    structuredContent: {
      response: { success: false, error: "HTTP ERROR 403" },
    },
  };
  mocks.call.mockImplementation(async ({ name }) =>
    name === "agent_browser_open"
      ? failure
      : name === "agent_browser_eval"
        ? pageFacts()
        : success(),
  );
  const result = await service.call(
    "agent_browser_open",
    { url: "https://denied.test/" },
    new AbortController().signal,
  );
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toEqual(failure.structuredContent);
  expect(JSON.stringify(result.content)).toContain("HTTP ERROR 403");
  expect(
    mocks.call.mock.calls.filter(
      ([call]) => call.name === "agent_browser_open",
    ),
  ).toHaveLength(1);
});

test.each(["native", "transport", "cdp", "page_wedged"])(
  "%s unknown outcome holds mutations and takeover until explicit restart",
  async (mode) => {
    const service = await setup();
    if (mode === "native")
      mocks.call.mockResolvedValueOnce(baseline.lostResponse);
    else if (mode === "page_wedged")
      mocks.call.mockResolvedValueOnce({
        content: [{ type: "text", text: "Page stopped responding" }],
        isError: true,
        structuredContent: { response: { code: "page_wedged" } },
      });
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

test("viewer input waits for browser replies and retains unknown delivery", async () => {
  const service = await setup();
  const view = await service.view(new AbortController().signal);
  await view.input(
    { action: "keyboard", subaction: "insertText", text: "Draft" },
    new AbortController().signal,
    12345,
  );
  await service.settle();
  mocks.cliError = true;
  await expect(
    view.input(
      { action: "input_mouse", type: "mouseMoved", x: 10, y: 20 },
      new AbortController().signal,
      12345,
    ),
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
