import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { openGateway } from "../src/harness/gateway.mjs";

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
  const gateway = await openGateway(
    [
      {
        name: "click",
        description: "Click",
        inputSchema: { type: "object" },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          properties: { effect: { type: "string" }, route: { type: "string" } },
          required: ["effect", "route"],
        },
      },
    ],
    async (_id, name, args, signal) =>
      service.request(
        {
          operation: "call",
          service: "desktop",
          name,
          arguments: args,
        },
        signal,
      ),
  );
  const client = new Client({ name: "test", version: "1" });
  onTestFinished(async () => {
    await client.close();
    await gateway.close();
    await service.close();
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(gateway.url)));
  await client.listTools();
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
  { pid: 7, steps: [{ type_text: { text: "Sales" } }] },
  { pid: 7, window_id: 90, steps: [{ type_text: { pid: 8, text: "Sales" } }] },
])(
  "batch rejects an incomplete numeric window identity before input: %j",
  async (target) => {
    const service = openComputerService(".", ".");
    const result = await service.request(
      {
        operation: "call",
        service: "desktop",
        name: "run_steps",
        arguments: {
          ...target,
          delivery_mode: "foreground",
          observe: {},
        },
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
    return { structuredJson: "{}", images: [], isError: false };
  });
  const service = openComputerService(".", ".");
  const signal = new AbortController().signal;
  const call = (args: Record<string, unknown>, name = "click") =>
    service.request(
      {
        operation: "call",
        service: "desktop",
        name,
        arguments: args,
        actor: { botId: 1, color: "#68b6ff", owner: "task" },
      },
      signal,
    );
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
    service.request(
      {
        operation: "call",
        service: "desktop",
        name: "click",
        arguments: { target, delivery_mode: "foreground" },
      },
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
  const result = await service.request(
    {
      operation: "call",
      service: "desktop",
      name: "click",
      arguments: {
        pid: 7,
        window_id: 90,
        x: 10,
        y: 20,
        delivery_mode: "foreground",
      },
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

test("sessions recover reads once, preserve uncertain actions and bound failures", async () => {
  const ok = { isError: false, images: [] };
  const ended = {
    ...ok,
    isError: true,
    errorCode: "session_ended",
    text: "Session ended",
  };
  const callTool = vi.fn(async (name: string) =>
    name === "start_session" || name === "set_agent_cursor_enabled"
      ? ok
      : ended,
  );
  const session = openDesktopSession({ callTool });
  const args = { session: "bot", pid: 7, window_id: 90 };
  await session.call("get_window_state", args, "task");
  expect(
    callTool.mock.calls.filter(([name]) => name === "get_window_state"),
  ).toHaveLength(2);
  callTool.mockClear();
  await session.call("click", args, "task");
  expect(callTool.mock.calls.filter(([name]) => name === "click")).toHaveLength(
    1,
  );
  callTool.mockImplementation(async (name: string) =>
    name === "click" ? { ...ended, errorCode: "target_unavailable" } : ok,
  );
  callTool.mockClear();
  for (let index = 0; index < 4; index++) {
    await session.call("bring_to_front", args, "task");
    await session.call("click", args, "task");
  }
  expect(callTool.mock.calls.filter(([name]) => name === "click")).toHaveLength(
    3,
  );
  await session.call("click", { ...args, x: 20 }, "task");
  expect(callTool.mock.calls.filter(([name]) => name === "click")).toHaveLength(
    4,
  );
  await session.call("click", args, "next-task");
  expect(
    callTool.mock.calls.filter(([name]) => name === "start_session"),
  ).toHaveLength(2);
});

test("image dedup retains target identity and resets with task ownership", async () => {
  const session = openDesktopSession({
    callTool: async () => ({ isError: false, images: [] }),
  });
  const args = { session: "bot", pid: 7, window_id: 90 };
  const images = [{ mimeType: "image/png", dataBase64: "pixels" }];
  await session.call("list_windows", args, "task");
  const frame = (target: object) =>
    session.images("bot", "task", "get_window_state", target, images);
  expect(frame(args)).toEqual(images);
  expect(frame({ ...args, snapshot_id: "new" })).toEqual([]);
  expect(frame({ ...args, window_id: 91 })).toEqual(images);
  session.clear("task");
  await session.call("list_windows", args, "task");
  expect(frame(args)).toEqual(images);
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

test.each(["click", "run_steps"])(
  "repeated %s stays bounded while screenshots animate",
  async (name) => {
    const callTool = vi.fn(async () => ({ isError: false, images: [] }));
    const session = openDesktopSession({ callTool });
    const args = {
      session: "bot",
      pid: 7,
      window_id: 90,
      steps: [{ click: { x: 10, y: 20 } }],
    };
    for (let index = 0; index < 4; index++) {
      const result = await session.call(name, args, "task");
      session.images("bot", "task", "get_window_state", args, [
        { mimeType: "image/png", dataBase64: String(index) },
      ]);
      expect(result.isError).toBe(index === 3);
    }
    expect(callTool.mock.calls).toHaveLength(5);
    callTool.mockImplementation(async () => ({
      isError: false,
      images: [],
      structuredJson: '{"status":"satisfied","stable":true}',
    }));
    await session.call("verify_state", args, "task");
    expect((await session.call(name, args, "task")).isError).toBe(false);
  },
);

test("capture failure preserves execution and reports failed observation", async () => {
  activity.captureExcluded = false;
  driver.callTool.mockImplementation(async (name: string) => ({
    isError: name === "get_window_state",
    images: [],
    text: name === "get_window_state" ? "Capture unavailable" : "1/1 steps ok",
    structuredJson: JSON.stringify(
      name === "run_steps"
        ? {
            steps: [{ index: 0, ok: true }],
            observation: { ok: true, state: { pid: 7, window_id: 90 } },
          }
        : { code: "capture_unavailable" },
    ),
  }));
  const service = openComputerService(".", ".");
  const result = await service.request(
    {
      operation: "call",
      service: "desktop",
      name: "run_steps",
      arguments: {
        steps: [{ click: { x: 10, y: 20 } }],
        observe: { include_screenshot: true },
      },
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
  await service.close();
});
