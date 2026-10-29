import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { openGateway } from "../src/harness/gateway.mjs";
import { productCatalog } from "../src/harness/product-tools.ts";
import type { EngineRuntime } from "../src/harness/task-types.ts";
import failures from "./fixtures/cua-contracts.json" with { type: "json" };

const { driver, activity } = vi.hoisted(() => ({
  driver: { callTool: vi.fn(), shutdown: vi.fn(), uniffiDestroy: vi.fn() },
  activity: {
    observe: vi.fn(),
    active: vi.fn(),
    captureExcluded: true,
    clear: vi.fn(),
    close: vi.fn(),
    capture: vi.fn(async (run: () => Promise<unknown>) => run()),
    target: (args: Record<string, unknown>) => args.target ?? args,
  },
}));
vi.mock("@trycua/cua-driver", () => ({ CuaDriver: { create: () => driver } }));
vi.mock("../src/harness/desktop-activity.mjs", () => ({
  openDesktopActivity: () => activity,
}));
const entry = "../src/harness/computer-service.mjs";
const { openComputerService } = await import(entry);
const sessionEntry = "../src/harness/desktop-session.mjs";
const { openDesktopSession } = await import(sessionEntry);
function callDesktop(
  service: ReturnType<typeof openComputerService>,
  name: string,
  args: Record<string, unknown>,
  signal = new AbortController().signal,
  actor?: { botId: number; color: string; owner: string },
) {
  return service.request(
    {
      operation: "call",
      service: "desktop",
      name,
      arguments: args,
      ...(actor ? { actor } : {}),
    },
    signal,
  );
}

afterEach(() => {
  vi.clearAllMocks();
  activity.active.mockReturnValue(false);
  activity.captureExcluded = true;
});

test("MCP validates native action output and retains Domos text", async () => {
  driver.callTool.mockResolvedValue({
    structuredJson: '{"effect":"confirmed","route":"background"}',
    images: [],
    isError: false,
  });
  const service = openComputerService(".", ".");
  const tools = [
    {
      name: "click",
      description: "Click",
      inputSchema: { type: "object" },
      annotations: { readOnlyHint: false, idempotentHint: false },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { effect: { type: "string" }, route: { type: "string" } },
        required: ["effect", "route"],
      },
    },
  ];
  const catalog = await productCatalog(
    {
      agent: async () => ({ callable: tools }),
      registry: { tools: () => [] },
      snapshot: async () => ({
        tools: [...tools, { ...tools[0], name: "other_bot" }],
      }),
    } as unknown as EngineRuntime,
    BACKGROUND_CONTEXT,
  );
  expect(catalog.filter((tool) => tool.name === "click")).toEqual(tools);
  expect(catalog.some((tool) => tool.name === "other_bot")).toBe(false);
  const gateway = await openGateway(catalog, async (_id, name, args, signal) =>
    callDesktop(service, name, args, signal),
  );
  const client = new Client({ name: "test", version: "1" });
  onTestFinished(async () => {
    await client.close();
    await gateway.close();
    await service.close();
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(gateway.url)));
  await client.listTools();
  expect((await client.listTools()).tools[0]).toEqual(tools[0]);
  const result = await client.callTool({
    name: "click",
    arguments: { pid: 7, window_id: 90 },
  });
  expect(result.structuredContent).toEqual({
    effect: "confirmed",
    route: "background",
  });
  expect(result.content).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("Domos computer tool time:"),
      }),
    ]),
  );
});

test.each([
  {
    steps: [{ scroll: { x: 100, y: 200, direction: "down", amount: 3 } }],
    screenshot: true,
  },
  {
    steps: [{ drag: { from_x: 10, from_y: 20, to_x: 100, to_y: 200 } }],
    screenshot: true,
  },
  {
    steps: [{ set_value: { role: "textfield", name: "Song", value: "Rain" } }],
    screenshot: false,
  },
  {
    steps: [{ press_key: { key: "return" } }],
    delivery_mode: "foreground",
    screenshot: true,
  },
  {
    steps: [{ click: { x: 100, y: 200 } }],
    observe: { include_screenshot: false, query: "Editor" },
    screenshot: false,
  },
])(
  "batch returns observation in one request: %j",
  async ({ screenshot, ...input }) => {
    const state = { pid: 7, window_id: 90, snapshot_id: "s1" };
    driver.callTool.mockResolvedValue({
      isError: false,
      images: [],
      structuredJson: JSON.stringify({
        steps: [{ ok: true }],
        observation: { ok: true, state },
      }),
    });
    const service = openComputerService(".", ".");
    const result = await callDesktop(
      service,
      "run_steps",
      { pid: 7, window_id: 90, ...input },
      new AbortController().signal,
    );
    const calls = driver.callTool.mock.calls.filter(
      ([name]) => name === "run_steps",
    );
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]?.[1]).observe).toMatchObject({
      include_screenshot: screenshot,
      ...(input.observe ?? {}),
    });
    expect(
      driver.callTool.mock.calls.some(([name]) => name === "get_window_state"),
    ).toBe(false);
    expect(result.structuredContent).toMatchObject({
      observation: { ok: true, state },
    });
    await service.close();
  },
);

test.each([
  { pid: 7, steps: [{ type_text: { text: "Sales" } }] },
  { pid: 7, window_id: 90, steps: [{ type_text: { pid: 8, text: "Sales" } }] },
])(
  "batch rejects an incomplete numeric window identity before input: %j",
  async (target) => {
    const service = openComputerService(".", ".");
    const result = await callDesktop(
      service,
      "run_steps",
      {
        ...target,
        delivery_mode: "foreground",
        observe: {},
      },
      new AbortController().signal,
    );
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("window_id");
    expect(driver.callTool).not.toHaveBeenCalled();
    await service.close();
  },
);

test("native foreground delivery and batch evidence use one driver call", async () => {
  const native = {
    images: [{ mimeType: "image/png", dataBase64: "cGl4ZWw=" }],
    text: "1/1 steps ok",
    isError: false,
    structuredJson: JSON.stringify({
      steps: [{ ok: true }],
      observation: { ok: true, state: { pid: 7, window_id: 90 } },
    }),
  };
  driver.callTool.mockResolvedValue(native);
  activity.captureExcluded = false;
  const service = openComputerService(".", ".");
  const signal = new AbortController().signal;
  const result = await callDesktop(
    service,
    "run_steps",
    {
      pid: 7,
      window_id: 90,
      delivery_mode: "foreground",
      steps: [{ click: { x: 10, y: 20 } }],
      observe: { include_screenshot: true },
    },
    signal,
  );
  expect(driver.callTool.mock.calls.map(([name]) => name)).toEqual([
    "start_session",
    "set_agent_cursor_enabled",
    "run_steps",
  ]);
  expect(result.structuredContent).toEqual(JSON.parse(native.structuredJson));
  expect(result.content).toContainEqual({
    type: "image",
    mimeType: "image/png",
    data: "cGl4ZWw=",
  });
  expect(result.content).toContainEqual({ type: "text", text: native.text });
  await service.close();
});

test.each(failures.mutations)(
  "%s preserves unknown outcomes, recovery and cancellation",
  async (name) => {
    const calls: string[] = [];
    let ended = false;
    const callTool = vi.fn(async (tool: string) => {
      calls.push(tool);
      return {
        images: [],
        isError: ended && tool === name,
        ...(ended && tool === name ? { errorCode: "session_ended" } : {}),
        structuredJson: JSON.stringify(
          tool === "get_window_state"
            ? { pid: 7, window_id: 90, snapshot_id: "s1" }
            : { verified: false },
        ),
      };
    });
    const session = openDesktopSession({ callTool });
    const args = {
      session: "bot",
      pid: 7,
      window_id: 90,
      steps: [{ click: { x: 10, y: 20 } }],
      script: "await cua.click({x:10,y:20})",
    };
    await session.call(name, args, "task");
    for (const next of ["click", "run_steps", "run_script"]) {
      expect(
        (await session.call(next, { ...args, delay: 130 }, "task")).isError,
      ).toBe(true);
    }
    expect(calls.filter((tool) => tool === name)).toHaveLength(1);
    await session.call("get_window_state", args, "task");
    ended = true;
    const result = await session.call(name, args, "task");
    expect(result.text).toContain("no action was replayed");
    expect(calls.filter((tool) => tool === name)).toHaveLength(2);
    const controller = new AbortController();
    controller.abort();
    await expect(
      session.call(name, args, "task", controller.signal),
    ).rejects.toThrow();
    expect(calls.filter((tool) => tool === name)).toHaveLength(2);
    ended = false;
    await session.call("get_window_state", args, "next-task");
    expect(calls.filter((tool) => tool === "start_session")).toHaveLength(3);
    const entered = Promise.withResolvers<void>();
    const running = new AbortController();
    callTool.mockImplementationOnce(async () => {
      entered.resolve();
      await new Promise<void>((resolve) =>
        running.signal.addEventListener("abort", () => resolve(), {
          once: true,
        }),
      );
      running.signal.throwIfAborted();
      return { images: [], isError: false, structuredJson: "{}" };
    });
    const aborted = expect(
      session.call(name, args, "next-task", running.signal),
    ).rejects.toThrow();
    await entered.promise;
    running.abort();
    await aborted;
    expect((await session.call(name, args, "next-task")).isError).toBe(true);
  },
);

test("a restarted desktop session returns fresh observation before using saved element tokens", async () => {
  const callTool = vi.fn(async (name: string) => ({
    isError: false,
    images: [],
    structuredJson: JSON.stringify(
      name === "get_window_state"
        ? { pid: 7, window_id: 90, snapshot_id: "fresh" }
        : {},
    ),
  }));
  const session = openDesktopSession({ callTool });
  const args = {
    session: "bot",
    pid: 7,
    window_id: 90,
    steps: [{ click: { element_token: "old:15" } }],
  };
  const recovered = await session.call("run_steps", args, "task");
  expect(recovered.isError).toBe(true);
  expect(recovered.text).toContain("not executed");
  expect(recovered.structuredJson).toBeUndefined();
  expect(callTool.mock.calls.some(([name]) => name === "run_steps")).toBe(
    false,
  );
  await session.call(
    "run_steps",
    { ...args, steps: [{ click: { element_token: "fresh:15" } }] },
    "task",
  );
  expect(
    callTool.mock.calls.filter(([name]) => name === "run_steps"),
  ).toHaveLength(1);
});

test("unconfirmed input requires observation and preserves native tree cursors", async () => {
  const calls: Record<string, unknown>[] = [];
  const session = openDesktopSession({
    callTool: async (name: string, json: string) => {
      const args = JSON.parse(json);
      calls.push({ name, ...args });
      return {
        isError: false,
        images: [],
        structuredJson: JSON.stringify(
          name === "type_text"
            ? { verified: false, effect: "unverifiable" }
            : name === "get_window_state"
              ? { pid: args.pid, window_id: args.window_id, snapshot_id: "s1" }
              : {},
        ),
      };
    },
  });
  const args = { session: "bot", pid: 7, window_id: 90 };
  const signal = new AbortController().signal;
  await session.call("type_text", args, "task", signal);
  expect((await session.call("press_key", args, "task", signal)).isError).toBe(
    true,
  );
  for (const size of [250, 250, 120, 120, 250])
    await session.call(
      "get_window_state",
      { ...args, since: "latest", max_elements: size },
      "task",
      signal,
    );
  expect(
    calls
      .filter((call) => call.name === "get_window_state")
      .map((call) => call.since),
  ).toEqual(["latest", "latest", "latest", "latest", "latest"]);
  expect((await session.call("press_key", args, "task", signal)).isError).toBe(
    false,
  );
});

test.each(["batch", "checked"])(
  "%s observation failure preserves execution and blocks replay",
  async (failure) => {
    activity.captureExcluded = failure !== "capture";
    driver.callTool.mockImplementation(async (name: string) => ({
      isError:
        name === "get_window_state" ||
        (name === "run_steps" && failure === "batch"),
      images: [],
      text:
        name === "get_window_state" ? "Capture unavailable" : "1/1 steps ok",
      structuredJson: JSON.stringify(
        name === "run_steps"
          ? {
              steps: [{ index: 0, ok: true }],
              observation:
                failure !== "capture"
                  ? { ok: false, error: "Capture unavailable" }
                  : { ok: true, state: { pid: 7, window_id: 90 } },
            }
          : { code: "capture_unavailable" },
      ),
    }));
    const service = openComputerService(".", ".");
    const result = await callDesktop(
      service,
      "run_steps",
      {
        steps: [
          {
            click: { x: 10, y: 20 },
            ...(failure === "checked" ? { expect: [{ text: "Done" }] } : {}),
          },
        ],
        observe: { include_screenshot: true },
      },
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      isError: failure === "batch",
      structuredContent: {
        observation: { ok: false, error: "Capture unavailable" },
      },
    });
    expect(result.content).toContainEqual({
      type: "text",
      text: "1/1 steps ok",
    });
    expect(
      driver.callTool.mock.calls.filter(([name]) => name === "run_steps"),
    ).toHaveLength(1);
    const blocked = await callDesktop(
      service,
      "run_steps",
      {
        pid: 7,
        window_id: 90,
        steps: [{ click: { x: 10, y: 20 } }],
      },
      new AbortController().signal,
    );
    expect(blocked.isError).toBe(true);
    expect(JSON.stringify(blocked.content)).toContain("Observe that window");
    expect(
      driver.callTool.mock.calls.filter(([name]) => name === "run_steps"),
    ).toHaveLength(1);
    await service.close();
  },
);
