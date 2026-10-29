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
        text: expect.stringContaining('"domos"'),
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

test("foreground input reuses its active window and visual reads do not delay execution", async () => {
  let front = 2;
  const restored: number[] = [];
  const events: string[] = [];
  activity.active.mockImplementation(
    (target: { window_id: number }) => front === target.window_id,
  );
  driver.callTool.mockImplementation(async (name: string, json: string) => {
    const args = JSON.parse(json);
    events.push(name);
    if (name === "bring_to_front") front = args.window_id;
    if (name === "click") restored.push(front);
    return { structuredJson: '{"verified":true}', images: [], isError: false };
  });
  const service = openComputerService(".", ".");
  const signal = new AbortController().signal;
  const call = (args: Record<string, unknown>, name = "click") =>
    callDesktop(service, name, args, signal, {
      botId: 1,
      color: "#68b6ff",
      owner: "task",
    });
  const target = { kind: "window", pid: 7, window_id: 90 };
  await call({ target, x: 10, y: 20, delivery_mode: "foreground" });
  await call({ target, x: 20, y: 30, delivery_mode: "foreground" });
  expect(restored).toEqual([90, 90]);
  expect(events.filter((event) => event === "bring_to_front")).toHaveLength(1);
  events.length = 0;
  await call({ target, x: 20, y: 30 });
  expect(events).not.toContain("bring_to_front");
  const steps = [
    {
      expect: [{ text: "Done" }],
      click: { target, delivery_mode: "foreground" },
    },
  ];
  await call({ pid: 7, window_id: 90, steps }, "run_steps");
  expect(events.filter((event) => event === "bring_to_front")).toHaveLength(0);
  expect(driver.callTool).toHaveBeenCalledWith(
    "run_steps",
    expect.stringContaining('"expect":[{"text":"Done"}]'),
    { signal },
  );
  await call({ steps, observe: { include_screenshot: true } }, "run_steps");
  expect(JSON.parse(driver.callTool.mock.calls.at(-1)?.[1]).observe).toEqual({
    include_screenshot: true,
    since: null,
  });
  activity.captureExcluded = false;
  driver.callTool.mockImplementation(async (name: string) => ({
    images: [],
    isError: name === "run_steps",
    structuredJson: JSON.stringify(
      name === "run_steps"
        ? { observation: { ok: true, state: { pid: 8, window_id: 91 } } }
        : { pid: 8, window_id: 91 },
    ),
  }));
  driver.callTool.mockClear();
  const interrupted = await call(
    { steps, observe: { include_screenshot: true } },
    "run_steps",
  );
  activity.captureExcluded = true;
  expect(interrupted.isError).toBe(true);
  expect(driver.callTool.mock.calls.map(([name]) => name)).toEqual([
    "run_steps",
    "get_window_state",
  ]);
  expect(JSON.parse(driver.callTool.mock.calls[1]?.[1])).toMatchObject({
    pid: 8,
    window_id: 91,
    include_screenshot: true,
    include_accessibility_tree: false,
  });
  for (const args of [
    { include_screenshot: false },
    { include_screenshot: true },
    {},
    { include_screenshot: false, screenshot_out_file: "capture.png" },
  ]) {
    activity.capture.mockClear();
    await call({ ...target, ...args }, "get_window_state");
    expect(activity.capture).toHaveBeenCalledTimes(
      args.include_screenshot === false && !args.screenshot_out_file ? 0 : 1,
    );
  }
  activity.active.mockReturnValue(false);
  const controller = new AbortController();
  driver.callTool.mockImplementation(async (name: string) => {
    if (name === "bring_to_front") controller.abort();
    return { images: [], isError: false };
  });
  driver.callTool.mockClear();
  await expect(
    callDesktop(
      service,
      "click",
      { target, delivery_mode: "foreground" },
      controller.signal,
    ),
  ).rejects.toThrow();
  expect(driver.callTool.mock.calls.some(([name]) => name === "click")).toBe(
    false,
  );
  await service.close();
});

test("activation failure returns its cause and does not send the input", async () => {
  driver.callTool.mockImplementation(async (name: string) => ({
    images: [],
    isError: name === "bring_to_front",
    text: name === "bring_to_front" ? "Activation denied" : "",
  }));
  const service = openComputerService(".", ".");
  const result = await callDesktop(
    service,
    "click",
    {
      pid: 7,
      window_id: 90,
      x: 10,
      y: 20,
      delivery_mode: "foreground",
    },
    new AbortController().signal,
  );
  expect(result).toMatchObject({
    isError: true,
    content: expect.arrayContaining([
      { type: "text", text: "Activation denied" },
    ]),
  });
  expect(driver.callTool.mock.calls.some(([name]) => name === "click")).toBe(
    false,
  );
  await service.close();
});

test.each([true, false])(
  "batch verification %s gives the next step from current evidence",
  async (checked) => {
    driver.callTool.mockResolvedValue({
      images: [],
      isError: false,
      structuredJson: JSON.stringify({
        steps: [{ ok: true }],
        observation: {
          ok: true,
          state: { pid: 7, window_id: 90, snapshot_id: "s1" },
        },
      }),
    });
    const service = openComputerService(".", ".");
    const result = await callDesktop(service, "run_steps", {
      pid: 7,
      window_id: 90,
      steps: [
        {
          click: { x: 10, y: 20 },
          ...(checked ? { expect: [{ text: "Playing" }] } : {}),
        },
      ],
    });
    expect(JSON.stringify(result.content)).toContain(
      checked ? "Continue from" : "returned observation",
    );
    await service.close();
  },
);

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

test("unconfirmed input requires observation and tree deltas use a matching baseline", async () => {
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
  ).toEqual([undefined, "latest", undefined, "latest", "latest"]);
  expect((await session.call("press_key", args, "task", signal)).isError).toBe(
    false,
  );
});

test.each(["capture", "batch", "checked"])(
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
      isError: true,
      structuredContent: {
        observation: { ok: false, error: "Capture unavailable" },
      },
    });
    expect(result.content).toContainEqual({
      type: "text",
      text: expect.stringContaining(
        '"execution":"delivered","verification":"required","observation":"failed"',
      ),
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
