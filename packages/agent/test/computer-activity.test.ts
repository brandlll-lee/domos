import { EventEmitter } from "node:events";
import { afterEach, expect, test, vi } from "vitest";
import { computerActivity } from "../src/computer/activity.ts";

const entry = "../src/harness/desktop-activity.mjs";
const { openDesktopActivity } = await import(entry);

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));
vi.mock("node:fs", () => ({ readFileSync: () => "electron" }));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("tracks exact windows, scaled captures, movement and Bot identity; capture and teardown clear the overlay", async () => {
  vi.useFakeTimers();
  const commands: unknown[] = [];
  const child = Object.assign(new EventEmitter(), {
    pid: 42,
    exitCode: null,
    connected: true,
    kill: vi.fn(),
    disconnect: vi.fn(() => {
      child.connected = false;
    }),
    send(value: { type?: string }, done: () => void) {
      commands.push(value);
      if (value?.type === "capture") child.emit("message", value);
      done();
    },
  });
  spawn.mockReturnValue(child);
  let bounds = { x: -800, y: 100, width: 800, height: 600 };
  const windows = () => [
    { pid: 7, window_id: 90, bounds, z_index: 1, is_on_screen: true },
    { pid: 8, window_id: 91, bounds: { ...bounds, width: 80 }, z_index: 2 },
  ];
  const driver = {
    callTool: vi.fn(async (name: string) => ({
      structuredJson: JSON.stringify(
        name === "list_windows"
          ? { windows: windows() }
          : { width: 1920, height: 1080 },
      ),
    })),
  };
  const updates: unknown[] = [];
  const activity = openDesktopActivity(driver, (value: unknown) =>
    updates.push(value),
  );
  const actor = { botId: 1, color: "#c4789b", owner: "task-1" };
  const target = { pid: 7, window_id: 90 };
  activity.observe(
    "get_window_state",
    target,
    {
      structuredJson: JSON.stringify({
        screenshot_width: 400,
        screenshot_height: 300,
        capture_id: "capture-1",
        snapshot_id: "s00000001",
      }),
    },
    actor,
  );
  child.emit("message", {
    type: "screen",
    bounds: { x: -1000, y: 0, width: 2920, height: 1080 },
  });
  activity.observe(
    "click",
    { ...target, x: 200, y: 150, capture_id: "capture-1" },
    null,
    actor,
  );
  await vi.advanceTimersByTimeAsync(100);
  expect(updates.at(-1)).toMatchObject({
    color: actor.color,
    window: bounds,
    pointer: { x: -400, y: 400 },
    covered: [{ width: 80 }],
  });
  expect(computerActivity.safeParse(updates.at(-1)).success).toBe(true);
  bounds = { ...bounds, x: -600 };
  await vi.advanceTimersByTimeAsync(100);
  expect(updates.at(-1)).toMatchObject({
    window: bounds,
    pointer: { x: -200 },
  });
  await activity.capture(async () => {
    expect(commands.at(-1)).toMatchObject({ type: "capture", hidden: true });
  });
  expect(commands.at(-1)).toMatchObject({ type: "capture", hidden: false });
  activity.clear("task-1");
  expect(updates.at(-1)).toBeNull();
  activity.observe("get_window_state", target, null, {
    botId: 2,
    color: "#80b780",
    owner: "task-2",
  });
  activity.clear("task-1");
  await vi.advanceTimersByTimeAsync(100);
  expect(updates.at(-1)).toMatchObject({
    botId: 2,
    color: "#80b780",
    pointer: null,
  });
  activity.observe("click", { element_token: "s00000001:2" }, null, {
    botId: 2,
    color: "#80b780",
    owner: "task-2",
  });
  await vi.advanceTimersByTimeAsync(100);
  expect(updates.at(-1)).toMatchObject({ window: bounds, pointer: null });
  activity.observe(
    "get_desktop_state",
    {},
    {
      structuredJson: JSON.stringify({
        screenshot_width: 1460,
        screenshot_height: 540,
      }),
    },
    actor,
  );
  activity.observe("click", { scope: "desktop", x: 300, y: 100 }, null, actor);
  await vi.advanceTimersByTimeAsync(100);
  expect(updates.at(-1)).toMatchObject({
    window: bounds,
    pointer: { x: -400, y: 200 },
  });
  await activity.close();
  await vi.advanceTimersByTimeAsync(3000);
  expect(updates.at(-1)).toBeNull();
});

test("a late observation cannot restore stopped effects and a failed helper does not block capture", async () => {
  vi.useFakeTimers();
  spawn.mockImplementation(() => {
    throw new Error("Display unavailable");
  });
  let resolve: (value: unknown) => void = () => {};
  const driver = {
    callTool: () =>
      new Promise((done) => {
        resolve = done;
      }),
  };
  const updates: unknown[] = [];
  const activity = openDesktopActivity(driver, (value: unknown) =>
    updates.push(value),
  );
  activity.observe("get_window_state", { pid: 1, window_id: 2 }, null, {
    botId: 1,
    color: "#123456",
    owner: "task",
  });
  activity.clear("task");
  resolve({ structuredJson: '{"windows":[]}' });
  await vi.advanceTimersByTimeAsync(100);
  expect(updates).toEqual([null]);
  await expect(activity.capture(async () => "screenshot")).resolves.toBe(
    "screenshot",
  );
  await activity.close();
});
