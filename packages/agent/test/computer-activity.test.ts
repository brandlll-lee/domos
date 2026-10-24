import { EventEmitter } from "node:events";
import { afterEach, expect, test, vi } from "vitest";
import { computerActivity } from "../src/computer/activity.ts";

const entry = "../src/harness/desktop-activity.mjs";
const { openDesktopActivity } = await import(entry);
const targetEntry = "../src/harness/desktop-target.mjs";
const actionsEntry = "../src/harness/desktop-actions.mjs";
const motionEntry = "../src/harness/desktop-motion.mjs";
const { desktopTarget } = await import(targetEntry);
const { openDesktopActions } = await import(actionsEntry);
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

test("batch completion updates position without replaying clicks and native trajectories resume in flight", () => {
  const actions = openDesktopActions();
  const target = { pid: 7, window_id: 90 };
  const bounds = { x: 0, y: 0, width: 1000, height: 700 };
  actions.observe("get_window_state", target, {
    screenshot_width: 1000,
    screenshot_height: 700,
  });
  const batch = {
    ...target,
    steps: [{ click: { x: 100, y: 200 } }, { click: { x: 900, y: 200 } }],
  };
  actions.observe("run_steps", batch);
  expect(actions.pointer({ ...target, bounds }, bounds)).toBeNull();
  actions.observe("run_steps", batch, {
    steps: [
      { index: 0, ok: true },
      { index: 1, ok: false },
    ],
  });
  const first = actions.pointer({ ...target, bounds }, bounds);
  expect(first).toMatchObject({ id: 1, x: 100, y: 200, action: "move_cursor" });
  actions.observe("run_steps", batch);
  actions.track({ position: { x: 350, y: 200 } });
  const tracked = actions.pointer({ ...target, bounds }, bounds);
  actions.observe("run_steps", batch, { steps: [{ index: 1, ok: true }] });
  expect(actions.pointer({ ...target, bounds }, bounds)).toEqual(tracked);
  actions.track({ position: null });
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60000);
  expect(actions.pointer({ ...target, bounds }, bounds)).toMatchObject({
    x: 350,
    y: 200,
  });
  const motion = openDesktopMotion();
  vi.spyOn(Date, "now").mockReturnValue(1000);
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

test.each([1, 1.25, 2])(
  "control and screenshot coordinates agree at scale %s",
  (scale) => {
    const actions = openDesktopActions();
    const target = { pid: 7, window_id: 90 };
    const bounds = { x: -800, y: 100, width: 800, height: 600 };
    const screen = { x: -1600, y: 0, width: 3520, height: 1080 };
    actions.observe("get_window_state", target, {
      snapshot_id: "s1",
      window_bounds: bounds,
      screenshot_width: 400,
      screenshot_height: 300,
      elements: [
        { element_token: "s1:2", frame: { x: -650, y: 200, w: 100, h: 100 } },
      ],
    });
    const physical = (point: { x: number; y: number }) => ({
      x: point.x * scale,
      y: point.y * scale,
    });
    actions.observe("click", { ...target, element_token: "s1:2" });
    expect(
      actions.pointer({ ...target, bounds }, screen, physical),
    ).toMatchObject({
      x: -600,
      y: 250,
    });
    actions.observe("click", { ...target, x: 100, y: 75 });
    expect(
      actions.pointer({ ...target, window_id: 91, bounds }, screen, physical),
    ).toBeNull();
    expect(
      actions.pointer({ ...target, bounds }, screen, physical),
    ).toMatchObject({
      x: -600,
      y: 250,
    });
  },
);

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("tracks window geometry and Bot identity; capture protection and short read failures preserve effects", async () => {
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
  let shown = true;
  let minimized = false;
  const windows = () => [
    ...(shown
      ? [
          {
            pid: 7,
            window_id: 90,
            bounds,
            z_index: 1,
            is_on_screen: true,
            minimized,
          },
        ]
      : []),
    { pid: 8, window_id: 91, bounds: { ...bounds, width: 80 }, z_index: 2 },
    { pid: 9, window_id: 92, app_name: "cua-driver", bounds, z_index: 3 },
    { pid: 10, window_id: 93, bounds, z_index: 4, on_current_space: false },
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
        window_bounds: bounds,
        elements: [
          {
            element_token: "s00000001:2",
            frame: { x: -700, y: 200, w: 100, h: 40 },
          },
        ],
      }),
    },
    actor,
  );
  expect(
    activity.target({ session: "", element_token: "s00000001:2" }),
  ).toEqual(target);
  child.emit("message", {
    type: "screen",
    bounds: { x: -1000, y: 0, width: 2920, height: 1080 },
    captureExcluded: true,
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
  child.emit("message", { type: "windows", ids: ["90"] });
  await vi.advanceTimersByTimeAsync(250);
  expect(updates.at(-1)).toMatchObject({ window: bounds, covered: [] });
  expect(activity.active(target)).toBe(true);
  bounds = { ...bounds, x: -600 };
  await vi.advanceTimersByTimeAsync(250);
  expect(updates.at(-1)).toMatchObject({
    window: bounds,
    pointer: { x: -200 },
  });
  child.emit("message", { type: "windows", ids: [] });
  await vi.advanceTimersByTimeAsync(1000);
  expect(updates.at(-1)).toMatchObject({ window: bounds });
  child.emit("message", { type: "windows", ids: ["90"] });
  shown = false;
  await vi.advanceTimersByTimeAsync(250);
  expect(updates.at(-1)).toMatchObject({ window: bounds });
  await vi.advanceTimersByTimeAsync(500);
  expect(updates.at(-1)).toMatchObject({ window: null });
  shown = true;
  await vi.advanceTimersByTimeAsync(250);
  minimized = true;
  await vi.advanceTimersByTimeAsync(250);
  expect(updates.at(-1)).toMatchObject({ window: null });
  minimized = false;
  await vi.advanceTimersByTimeAsync(250);
  const commandCount = commands.length;
  await activity.capture(async () => "screenshot");
  expect(commands).toHaveLength(commandCount);
  const read = driver.callTool.getMockImplementation();
  driver.callTool.mockRejectedValue(new Error("Window query unavailable"));
  await vi.advanceTimersByTimeAsync(1000);
  expect(updates.at(-1)).toMatchObject({
    window: bounds,
    pointer: { x: -200 },
  });
  await vi.advanceTimersByTimeAsync(2000);
  expect(updates.at(-1)).toMatchObject({ window: null, pointer: { x: -200 } });
  if (read) driver.callTool.mockImplementation(read);
  await vi.advanceTimersByTimeAsync(250);
  expect(updates.at(-1)).toMatchObject({ window: bounds });
  await vi.advanceTimersByTimeAsync(60000);
  expect(updates.at(-1)).toMatchObject({
    window: bounds,
    pointer: { x: -200 },
  });
  expect(computerActivity.safeParse(updates.at(-1)).success).toBe(true);
  activity.observe(
    "run_steps",
    { ...target, session: "task", steps: [] },
    null,
    actor,
  );
  driver.callTool.mockImplementation(async (name: string) => ({
    structuredJson: JSON.stringify(
      name === "get_agent_cursor_state"
        ? { position: { x: -300, y: 220 } }
        : { windows: windows() },
    ),
  }));
  await vi.advanceTimersByTimeAsync(250);
  const point = (updates.at(-1) as { pointer: { id: number } }).pointer;
  expect(point).toMatchObject({ x: -300, y: 220, action: "move_cursor" });
  await vi.advanceTimersByTimeAsync(500);
  expect(updates.at(-1)).toMatchObject({ pointer: { id: point.id } });
  activity.clear("task-1");
  expect(updates.at(-1)).toBeNull();
  activity.observe("get_window_state", target, null, {
    botId: 2,
    color: "#80b780",
    owner: "task-2",
  });
  activity.clear("task-1");
  await vi.advanceTimersByTimeAsync(250);
  expect(updates.at(-1)).toMatchObject({ botId: 2, color: "#80b780" });
  let acknowledge = () => {};
  vi.spyOn(child, "send").mockImplementationOnce((_value, done) => {
    acknowledge = done;
  });
  activity.observe("list_windows", {}, null, { ...actor, owner: "task-2" });
  activity.clear("task-2");
  acknowledge();
  expect(commands.at(-1)).toBeNull();
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

test("delayed capture acknowledgements preserve effects and an exited overlay recovers", async () => {
  vi.useFakeTimers();
  let delay: number | undefined = 500;
  const create = () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 42,
      exitCode: null as number | null,
      connected: true,
      kill: vi.fn(),
      disconnect: vi.fn(),
      send(
        value: { type?: string; id?: number; hidden?: boolean },
        done: () => void,
      ) {
        if (value?.type === "capture" && value.id && delay !== undefined)
          setTimeout(() => child.emit("message", value), delay);
        done();
      },
    });
    return child;
  };
  const children: ReturnType<typeof create>[] = [];
  spawn.mockImplementation(() => {
    const child = create();
    children.push(child);
    return child;
  });
  const driver = {
    callTool: async () => ({
      structuredJson: '{"windows":[],"width":1920,"height":1080}',
    }),
  };
  const activity = openDesktopActivity(driver, () => {});
  const actor = { botId: 1, color: "#68b6ff", owner: "task" };
  activity.observe("list_windows", {}, null, actor);
  const ready = {
    type: "screen",
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  };
  const capture = vi.fn(async () => "screenshot");
  const first = activity.capture(capture);
  const concurrent = activity.capture(capture);
  await vi.advanceTimersByTimeAsync(300);
  expect(children[0]?.kill).not.toHaveBeenCalled();
  expect(capture).not.toHaveBeenCalled();
  children[0]?.emit("message", ready);
  children[0]?.emit("message", { type: "capture", id: 999 });
  expect(capture).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(500);
  await expect(first).resolves.toBe("screenshot");
  await expect(concurrent).resolves.toBe("screenshot");
  expect(capture).toHaveBeenCalledTimes(2);
  if (children[0]) {
    children[0].connected = false;
    children[0].exitCode = 1;
    children[0].emit("exit", 1);
  }
  await vi.advanceTimersByTimeAsync(1200);
  expect(children).toHaveLength(2);
  const current = children[1];
  current?.emit("message", ready);
  delay = undefined;
  current?.kill.mockImplementation(() => {
    setTimeout(() => {
      current.exitCode = 1;
      current.connected = false;
      current.emit("exit", 1);
    }, 250);
  });
  const timedOut = activity.capture(capture);
  await vi.advanceTimersByTimeAsync(2000);
  expect(current?.kill).toHaveBeenCalledOnce();
  expect(capture).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(250);
  await expect(timedOut).resolves.toBe("screenshot");
  await vi.advanceTimersByTimeAsync(1200);
  expect(children).toHaveLength(3);
  activity.clear("task");
  await activity.close();
  await vi.advanceTimersByTimeAsync(3000);
  expect(children).toHaveLength(3);
});
