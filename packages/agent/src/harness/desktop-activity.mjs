import { spawn } from "node:child_process";
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
  let failed = false;
  let ready = false;
  let sending = false;
  let closed = false;
  let screen;
  let nativeScreen;
  let displays = [];
  let visibleWindows;
  let timer;
  let expiresAt = 0;
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
    emit(value);
    if (ready && child?.connected && !sending) {
      sending = true;
      child.send(value, () => {
        sending = false;
      });
    }
  }
  function start() {
    if (child || failed || closed) return;
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
      child = spawn(executable, args, {
        env,
        windowsHide: true,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      child.on("message", (value) => {
        if (value.type === "windows") visibleWindows = new Set(value.ids);
        if (value.type === "screen" && value.bounds) {
          screen = value.bounds;
          displays = value.displays ?? [];
          nativeScreen = undefined;
          ready = true;
          if (capturesInProgress)
            child.send({ type: "capture", hidden: true }, () => {});
        }
        if (value.type === "capture") acknowledgements.get(value.id)?.();
      });
      child.on("error", () => {
        failed = true;
      });
      child.on("exit", () => {
        failed = true;
        ready = false;
      });
    } catch {
      failed = true;
    }
  }
  function clear() {
    actor = undefined;
    actions.clear();
    motion.clear();
    selected = undefined;
    generation++;
    clearTimeout(timer);
    timer = undefined;
    send(null);
  }
  async function tick() {
    if (!actor || closed || expiresAt <= Date.now()) return clear();
    const current = generation;
    try {
      const listed = await read("list_windows");
      const windows = (listed.windows ?? []).filter(
        (item) =>
          item.pid !== child?.pid &&
          item.app_name !== "cua-driver" &&
          item.app_name !== "cua-driver.exe" &&
          (!visibleWindows || visibleWindows.has(String(item.window_id))) &&
          item.on_current_space !== false &&
          item.is_on_screen !== false &&
          !item.minimized,
      );
      if (current !== generation || closed || !actor) return;
      let { window } = desktopTarget(windows, actions.target, selected);
      nativeScreen ??= await read("get_screen_size");
      screen ??= {
        x: 0,
        y: 0,
        width: nativeScreen.width,
        height: nativeScreen.height,
      };
      if (current !== generation || closed || !actor) return;
      const pointer = actions.pointer(window?.bounds, screen, (point) => {
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
      });
      if (pointer?.desktop && located !== pointer.id) {
        located = pointer.id;
        window = desktopTarget(
          windows,
          actions.target,
          selected,
          pointer,
        ).window;
        actions.target = window && {
          pid: window.pid,
          window_id: window.window_id,
        };
      }
      selected = window;
      const { covered } = desktopTarget(windows, window, undefined);
      send({
        ...actor,
        screen,
        window: window?.bounds ?? null,
        covered,
        pointer: pointer ? motion.move(pointer) : null,
        expiresAt: Math.min(expiresAt, Date.now() + 2500),
      });
    } catch {
      if (current === generation) send(null);
    }
  }
  function schedule() {
    if (pending) return pending;
    pending = tick().finally(() => {
      pending = undefined;
      if (actor && !closed)
        timer = setTimeout(() => {
          timer = undefined;
          schedule();
        }, 100);
    });
    return pending;
  }
  return {
    target: actions.resolve,
    async refresh() {
      clearTimeout(timer);
      timer = undefined;
      await pending;
      clearTimeout(timer);
      timer = undefined;
      if (!closed && actor) await schedule();
    },
    observe(name, args, result, identity) {
      if (closed || !identity || !/^#[0-9a-f]{6}$/i.test(identity.color))
        return;
      actor = { botId: identity.botId, color: identity.color };
      owner = identity.owner;
      expiresAt = Date.now() + 60000;
      try {
        actions.observe(
          name,
          args,
          result ? JSON.parse(result.structuredJson ?? "{}") : null,
        );
      } catch {}
      start();
      if (!timer && !pending) schedule();
    },
    async capture(run) {
      const overlay = child;
      const hidden = ++capturesInProgress;
      if (ready && overlay?.connected && hidden === 1) {
        const id = ++sequence;
        captureReady = new Promise((resolve) => {
          const timer = setTimeout(() => {
            overlay.kill();
            resolve();
          }, 200);
          acknowledgements.set(id, () => {
            clearTimeout(timer);
            resolve();
          });
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
      await pending?.catch(() => {});
      if (child?.connected) child.disconnect();
      if (child && child.exitCode === null) {
        const stop = setTimeout(() => child.kill(), 2000);
        stop.unref();
        child.once("exit", () => clearTimeout(stop));
      }
    },
  };
}
