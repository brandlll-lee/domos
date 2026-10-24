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
  expect(
    JSON.parse(driver.callTool.mock.calls.at(-1)?.[1]).observe
      .include_screenshot,
  ).toBe(true);
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
