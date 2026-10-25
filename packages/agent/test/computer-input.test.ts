import { afterEach, expect, test, vi } from "vitest";

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
afterEach(() => vi.clearAllMocks());

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
    since: "latest",
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
    content: [{ type: "text", text: "Activation denied" }],
  });
  expect(driver.callTool.mock.calls.some(([name]) => name === "click")).toBe(
    false,
  );
  await service.close();
});

test("sessions recover observations once, preserve actions and bound failed retries", async () => {
  const ended = {
    isError: true,
    errorCode: "session_ended",
    text: "Session ended",
    images: [],
  };
  const ok = { isError: false, images: [] };
  let expired = true;
  driver.callTool.mockImplementation(async (name: string) => {
    if (name === "get_window_state" && expired) {
      expired = false;
      return ended;
    }
    return ok;
  });
  const session = openDesktopSession(driver);
  const args = { session: "bot", pid: 7, window_id: 90 };
  const signal = new AbortController().signal;
  await expect(
    session.call("get_window_state", args, "task", signal),
  ).resolves.toEqual(ok);
  expect(driver.callTool.mock.calls.map(([name]) => name)).toEqual([
    "start_session",
    "set_agent_cursor_enabled",
    "get_window_state",
    "start_session",
    "set_agent_cursor_enabled",
    "get_window_state",
  ]);
  driver.callTool.mockClear();
  driver.callTool.mockImplementation(async (name: string) =>
    name === "start_session" || name === "set_agent_cursor_enabled"
      ? ok
      : ended,
  );
  await expect(session.call("click", args, "task", signal)).resolves.toEqual(
    ended,
  );
  expect(driver.callTool).toHaveBeenCalledTimes(1);
  driver.callTool.mockClear();
  await expect(
    session.call("get_window_state", args, "task", signal),
  ).resolves.toEqual(ended);
  expect(
    driver.callTool.mock.calls.filter(([name]) => name === "get_window_state"),
  ).toHaveLength(2);

  driver.callTool.mockImplementation(async (name: string) =>
    name === "click"
      ? { ...ok, isError: true, text: "Target unavailable" }
      : ok,
  );
  driver.callTool.mockClear();
  for (let index = 0; index < 4; index++)
    await session.call("click", args, "task", signal);
  expect(
    driver.callTool.mock.calls.filter(([name]) => name === "click"),
  ).toHaveLength(3);
  await session.call("click", { ...args, x: 20 }, "task", signal);
  expect(
    driver.callTool.mock.calls.filter(([name]) => name === "click"),
  ).toHaveLength(4);
  await session.call("click", args, "next-task", signal);
  expect(
    driver.callTool.mock.calls.filter(([name]) => name === "start_session"),
  ).toHaveLength(2);

  const images = [{ mimeType: "image/png", dataBase64: "pixels" }];
  expect(
    session.images("bot", "next-task", "get_window_state", args, images),
  ).toEqual(images);
  expect(
    session.images(
      "bot",
      "next-task",
      "get_window_state",
      { ...args, snapshot_id: "new" },
      images,
    ),
  ).toEqual([]);
  expect(
    session.images(
      "bot",
      "next-task",
      "get_window_state",
      { ...args, window_id: 91 },
      images,
    ),
  ).toEqual(images);
  session.clear("next-task");
  await session.call("list_windows", args, "next-task", signal);
  expect(
    session.images("bot", "next-task", "get_window_state", args, images),
  ).toEqual(images);
  driver.callTool.mockImplementation(async () => ok);
  driver.callTool.mockClear();
  for (let index = 0; index < 3; index++) {
    await session.call("click", args, "next-task", signal);
    session.images("bot", "next-task", "get_window_state", args, images);
  }
  expect((await session.call("click", args, "next-task", signal)).isError).toBe(
    true,
  );
  expect(driver.callTool).toHaveBeenCalledTimes(3);
  session.images("bot", "next-task", "get_window_state", args, [
    { ...images[0], dataBase64: "changed" },
  ]);
  expect((await session.call("click", args, "next-task", signal)).isError).toBe(
    false,
  );
});
