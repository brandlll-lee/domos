import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDesktopActions } from "./desktop-actions.mjs";
import { openDesktopMotion } from "./desktop-motion.mjs";
import { desktopTarget } from "./desktop-target.mjs";

export function openDesktopActivity(driver, emit) {
  let actor;
  let owner;
  const actions = openDesktopActions();
  const motion = openDesktopMotion();
  let child;
  let retryAt = 0;
  let frame;
  let ready = false;
  let captureExcluded = false;
  let sending = false;
  let closed = false;
  let screen;
  let displays = [];
  let visibleWindows;
  let timer;
  let heartbeat;
  let cursorRead;
  let windows = [];
  let observedAt = 0;
  let missingAt;
  let covered = [];
  let sequence = 0;
  let located;
  let selected;
  let generation = 0;
  let pending;
  let capturesInProgress = 0;
  let captureReady = Promise.resolve();
  const acknowledgements = new Map();
  const read = async (name, args = {}) => {
    const result = await driver.callTool(name, JSON.stringify(args), {
      signal: AbortSignal.timeout(1500),
    });
    if (result.isError) throw new Error("Desktop observation failed");
    return JSON.parse(result.structuredJson ?? "{}");
  };
  function send(value) {
    frame = value;
    emit(value);
    if (value && !capturesInProgress) start();
    if (ready && child?.connected && !sending) {
      const overlay = child;
      sending = true;
      overlay.send(value, (error) => {
        if (child !== overlay) return;
        sending = false;
        if (error) overlay.kill();
        else if (frame !== value) send(frame);
      });
    }
  }
  function start() {
    if (child || closed || !actor || capturesInProgress || Date.now() < retryAt)
      return;
    retryAt = Date.now() + 1000;
    try {
      const distribution = dirname(
        createRequire(import.meta.url).resolve("electron/package.json"),
      );
      const executable = join(
        distribution,
        "dist",
        readFileSync(join(distribution, "path.txt"), "utf8").trim(),
      );
      const args = [
        fileURLToPath(new URL("desktop-overlay.mjs", import.meta.url)),
      ];
      if (
        process.platform === "linux" &&
        process.env.AGENT_BROWSER_ARGS?.includes("--no-sandbox")
      )
        args.push("--no-sandbox");
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const overlay = spawn(executable, args, {
        env,
        windowsHide: true,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      child = overlay;
      overlay.on("message", (value) => {
        if (child !== overlay) return;
        if (value.type === "windows") visibleWindows = new Set(value.ids);
        if (value.type === "screen" && value.bounds) {
          screen = value.bounds;
          displays = value.displays ?? [];
          ready = true;
          captureExcluded = value.captureExcluded === true;
          for (const id of acknowledgements.keys())
            overlay.send({ type: "capture", id, hidden: true }, () => {});
          send(frame ?? null);
        }
        if (value.type === "capture") acknowledgements.get(value.id)?.();
      });
      const ended = () => {
        if (child !== overlay) return;
        child = undefined;
        ready = false;
        captureExcluded = false;
        sending = false;
        visibleWindows = undefined;
        retryAt = Date.now() + 1000;
        for (const acknowledge of acknowledgements.values()) acknowledge();
      };
      overlay.on("error", ended);
      overlay.on("exit", ended);
    } catch {}
  }
  function clear() {
    actor = undefined;
    actions.clear();
    motion.clear();
    selected = undefined;
    generation++;
    clearTimeout(timer);
    clearInterval(heartbeat);
    timer = heartbeat = undefined;
    missingAt = undefined;
    observedAt = 0;
    windows = [];
    covered = [];
    send(null);
  }
  function publish() {
    if (!actor || closed || !screen) return;
    if (Date.now() - observedAt > 2500) selected = undefined;
    const pointer =
      actions.pointer(selected?.bounds, screen, (point) => {
        if (process.platform !== "win32") return point;
        const display = displays.find(
          ({ dip }) =>
            point.x >= dip.x &&
            point.y >= dip.y &&
            point.x < dip.x + dip.width &&
            point.y < dip.y + dip.height,
        );
        return display
          ? {
              x:
                display.physical.x +
                ((point.x - display.dip.x) * display.physical.width) /
                  display.dip.width,
              y:
                display.physical.y +
                ((point.y - display.dip.y) * display.physical.height) /
                  display.dip.height,
            }
          : point;
      }) ?? frame?.pointer;
    if (pointer?.desktop && located !== pointer.id) {
      located = pointer.id;
      const window = desktopTarget(
        windows,
        actions.target,
        selected,
        pointer,
      ).window;
      if (window) {
        selected = window;
        actions.target = { pid: window.pid, window_id: window.window_id };
        covered = desktopTarget(windows, window).covered;
      }
    }
    const expiresAt = Date.now() + 2500;
    send({
      ...actor,
      screen,
      window: selected?.bounds ?? null,
      covered: selected ? covered : [],
      pointer: pointer ? { ...motion.move(pointer), expiresAt } : null,
      expiresAt,
    });
  }
  function pulse() {
    publish();
    const session = actions.session;
    if (cursorRead || session === undefined) return;
    const current = generation;
    cursorRead = read("get_agent_cursor_state", { session })
      .then((state) => {
        if (
          current !== generation ||
          !actor ||
          closed ||
          actions.session !== session
        )
          return;
        actions.track(state);
        publish();
      })
      .catch(() => {})
      .finally(() => {
        cursorRead = undefined;
      });
  }
  async function tick() {
    if (!actor || closed) return;
    const current = generation;
    try {
      const listed = await read("list_windows");
      if (current !== generation || closed || !actor) return;
      const eligible = (listed.windows ?? []).filter(
        (item) =>
          item.pid !== child?.pid &&
          item.app_name !== "cua-driver" &&
          item.app_name !== "cua-driver.exe" &&
          item.on_current_space !== false &&
          item.is_on_screen !== false &&
          !item.minimized,
      );
      windows = eligible.filter(
        (item) => !visibleWindows || visibleWindows.has(String(item.window_id)),
      );
      const { window } = desktopTarget(eligible, actions.target, selected);
      const hidden =
        selected &&
        (listed.windows ?? []).some(
          (item) =>
            item.pid === selected.pid &&
            String(item.window_id) === String(selected.window_id) &&
            (item.minimized ||
              item.is_on_screen === false ||
              item.on_current_space === false),
        );
      if (window) {
        if (!windows.includes(window)) windows.push(window);
        selected = window;
        missingAt = undefined;
      } else {
        missingAt ??= Date.now();
        if (hidden || Date.now() - missingAt >= 500) selected = undefined;
      }
      if (window === selected)
        covered = desktopTarget(windows, selected).covered;
      else if (!selected) covered = [];
      observedAt = Date.now();
      if (!screen) {
        const size = await read("get_screen_size");
        if (current !== generation || closed || !actor) return;
        screen ??= { x: 0, y: 0, width: size.width, height: size.height };
      }
      publish();
    } catch {}
  }
  function schedule() {
    if (pending) return pending;
    pending = tick().finally(() => {
      pending = undefined;
      if (actor && !closed)
        timer = setTimeout(() => {
          timer = undefined;
          schedule();
        }, 250);
    });
    return pending;
  }
  return {
    target: actions.resolve,
    get captureExcluded() {
      return captureExcluded;
    },
    active(target) {
      if (Date.now() - observedAt > 1000) return false;
      const front = windows.reduce(
        (best, item) => (!best || item.z_index > best.z_index ? item : best),
        undefined,
      );
      return (
        front?.pid === target.pid &&
        (target.window_id === undefined ||
          String(front.window_id) === String(target.window_id))
      );
    },
    observe(name, args, result, identity) {
      if (closed || !identity || !/^#[0-9a-f]{6}$/i.test(identity.color))
        return;
      if (actor && owner !== identity.owner) clear();
      actor = { botId: identity.botId, color: identity.color };
      owner = identity.owner;
      try {
        actions.observe(
          name,
          args,
          result ? JSON.parse(result.structuredJson ?? "{}") : null,
        );
      } catch {}
      start();
      heartbeat ??= setInterval(pulse, 100);
      publish();
      if (!timer && !pending) schedule();
    },
    async capture(run) {
      if (captureExcluded) return run();
      const overlay = child;
      const hidden = ++capturesInProgress;
      if (hidden === 1) captureReady = Promise.resolve();
      if (overlay?.connected && hidden === 1) {
        const id = ++sequence;
        captureReady = new Promise((resolve, reject) => {
          const timer = setTimeout(async () => {
            try {
              const exited = once(overlay, "exit", {
                signal: AbortSignal.timeout(1000),
              });
              overlay.kill();
              await exited;
              resolve();
            } catch {
              reject(new Error("电脑操作效果未能隐藏，请重试截图。"));
            }
          }, 2000);
          acknowledgements.set(id, () => {
            clearTimeout(timer);
            resolve();
          });
          if (ready)
            overlay.send({ type: "capture", id, hidden: true }, () => {});
        }).finally(() => acknowledgements.delete(id));
      }
      try {
        await captureReady;
        return await run();
      } finally {
        if (--capturesInProgress === 0 && overlay?.connected)
          overlay.send({ type: "capture", hidden: false }, () => {});
      }
    },
    clear(expected) {
      if (!expected || expected === owner) clear();
    },
    async close() {
      closed = true;
      clear();
      await Promise.allSettled([pending, cursorRead]);
      if (child?.connected) child.disconnect();
      if (child && child.exitCode === null) {
        const stop = setTimeout(() => child.kill(), 2000);
        stop.unref();
        child.once("exit", () => clearTimeout(stop));
      }
    },
  };
}
