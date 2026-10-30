import { EventEmitter } from "node:events";
import { afterEach, expect, test, vi } from "vitest";
import { computerActivity } from "../src/computer/activity.ts";

const entry = "../src/harness/desktop-activity.mjs";
const { openDesktopActivity } = await import(entry);
const targetEntry = "../src/harness/desktop-target.mjs";
const motionEntry = "../src/harness/desktop-motion.mjs";
const { desktopTarget } = await import(targetEntry);
const { openDesktopMotion } = await import(motionEntry);

test("window targets use exact identity, app fallback and held windows; occlusion stays inside the target", () => {
  const bounds = { x: -800, y: 100, width: 800, height: 600 };
  const window = { pid: 7, window_id: 90, bounds, z_index: 1 };
  const dialog = {
    ...window,
    window_id: 91,
    z_index: 2,
    bounds: { ...bounds, width: 200 },
  };
  const other = {
    ...window,
    pid: 8,
    window_id: 92,
    z_index: 3,
    bounds: { x: -50, y: 0, width: 500, height: 1000 },
  };
  const windows = [window, dialog, other];
  expect(desktopTarget(windows, window).window).toBe(window);
  expect(desktopTarget(windows, { pid: 7 }).window).toBe(dialog);
  expect(desktopTarget(windows, { pid: 7, window_id: 99 }).window).toBe(dialog);
  expect(desktopTarget(windows, undefined, window).window).toBe(window);
  expect(desktopTarget([other], { pid: 7 }, window).window).toBeUndefined();
  expect(desktopTarget(windows, window).covered).toEqual([
    dialog.bounds,
    { x: -50, y: 100, width: 50, height: 600 },
  ]);
  expect(
    desktopTarget(windows, undefined, undefined, { x: -25, y: 200 }).window,
  ).toBe(other);
});

test("native trajectories resume in flight", () => {
  const motion = openDesktopMotion();
  vi.spyOn(Date, "now").mockReturnValue(1000);
  const first = { id: 1, x: 100, y: 200, action: "move_cursor" };
  motion.move(first);
  const next = motion.move({ ...first, id: 2, x: 900 });
  expect(next.motion.length).toBeGreaterThan(2);
  expect(next.motion.at(-1)).toMatchObject({ x: 900, y: 200 });
  vi.spyOn(Date, "now").mockReturnValue(1100);
  const resumed = motion.move({ ...first, id: 3, x: 300 });
  expect(resumed.motion[0].x).toBeGreaterThan(100);
  expect(resumed.motion[0].x).toBeLessThan(900);
  motion.clear();
});

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));
vi.mock("node:module", () => ({
  createRequire: () => ({ resolve: () => "/electron/package.json" }),
}));
vi.mock("node:fs", () => ({ readFileSync: () => "electron" }));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("effects use returned observations and expire geometry without querying the driver", async () => {
  vi.useFakeTimers();
  const commands: unknown[] = [];
  const child = Object.assign(new EventEmitter(), {
    pid: 42,
    exitCode: null,
    connected: true,
    kill: vi.fn(),
    disconnect: vi.fn(),
    send(value: unknown, done: () => void) {
      commands.push(value);
      done();
    },
  });
  spawn.mockReturnValue(child);
  const updates: unknown[] = [];
  const activity = openDesktopActivity((value: unknown) => updates.push(value));
  const actor = { botId: 1, color: "#c4789b", owner: "task-1" };
  const target = { pid: 7, window_id: 90 };
  const bounds = { x: -800, y: 100, width: 800, height: 600 };
  activity.observe(
    "get_window_state",
    target,
    {
      structuredJson: JSON.stringify({
        ...target,
        window_bounds: bounds,
        screenshot_width: 400,
        screenshot_height: 300,
        capture_id: "capture-1",
        snapshot_id: "s1",
        elements: [
          { element_token: "s1:2", frame: { x: -700, y: 200, w: 100, h: 40 } },
        ],
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
  await vi.advanceTimersByTimeAsync(250);
  expect(updates.at(-1)).toMatchObject({
    color: actor.color,
    window: bounds,
    pointer: { x: -400, y: 400 },
  });
  expect(computerActivity.safeParse(updates.at(-1)).success).toBe(true);
  activity.observe(
    "run_steps",
    { ...target, steps: [{ click: { element_token: "s1:2" } }] },
    null,
    actor,
  );
  activity.observe(
    "run_steps",
    { ...target, steps: [{ click: { element_token: "s1:2" } }] },
    {
      structuredJson: '{"steps":[{"index":0,"ok":true}]}',
    },
    actor,
  );
  expect(updates.at(-1)).toMatchObject({ pointer: { x: -650, y: 220 } });
  await vi.advanceTimersByTimeAsync(3000);
  expect(updates.at(-1)).toMatchObject({ window: null });
  expect(
    commands.some((value) => (value as { type?: string })?.type === "capture"),
  ).toBe(false);
  activity.clear("task-1");
  expect(updates.at(-1)).toBeNull();
  await activity.close();
});

test("overlay failure and closure leave no effect work pending", async () => {
  vi.useFakeTimers();
  spawn.mockImplementation(() => {
    throw new Error("Display unavailable");
  });
  const updates: unknown[] = [];
  const activity = openDesktopActivity((value: unknown) => updates.push(value));
  activity.observe("run_script", {}, null, {
    botId: 1,
    color: "#123456",
    owner: "task",
  });
  activity.clear("task");
  await activity.close();
  await vi.advanceTimersByTimeAsync(5000);
  expect(updates).toEqual([null, null]);
});
