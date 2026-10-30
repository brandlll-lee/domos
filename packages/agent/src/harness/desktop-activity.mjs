import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDesktopActions } from "./desktop-actions.mjs";
import { openDesktopMotion } from "./desktop-motion.mjs";
import { desktopTarget } from "./desktop-target.mjs";

export function openDesktopActivity(emit) {
  let actor;
  let owner;
  const actions = openDesktopActions();
  const motion = openDesktopMotion();
  let child;
  let retryAt = 0;
  let frame;
  let ready = false;
  let sending = false;
  let closed = false;
  let screen;
  let displays = [];
  let visibleWindows;
  let heartbeat;
  let windows = [];
  let observedAt = 0;
  let covered = [];
  let located;
  let selected;
  function send(value) {
    frame = value;
    emit(value);
    if (value) start();
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
    if (child || closed || !actor || Date.now() < retryAt) return;
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
          send(frame ?? null);
        }
      });
      const ended = () => {
        if (child !== overlay) return;
        child = undefined;
        ready = false;
        sending = false;
        visibleWindows = undefined;
        retryAt = Date.now() + 1000;
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
    clearInterval(heartbeat);
    heartbeat = undefined;
    observedAt = 0;
    windows = [];
    covered = [];
    send(null);
  }
  function publish() {
    if (!actor || closed || !screen) return;
    if (Date.now() - observedAt > 2500) selected = undefined;
    const pointer =
      actions.pointer(selected, screen, (point) => {
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
  return {
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
      const value = result ? JSON.parse(result.structuredJson ?? "{}") : null;
      const observation = value?.observation?.ok
        ? value.observation.state
        : value;
      if (name === "list_windows" && Array.isArray(value?.windows))
        windows = value.windows.filter(
          (item) =>
            item.pid !== child?.pid &&
            !["cua-driver", "cua-driver.exe"].includes(item.app_name) &&
            !item.minimized &&
            item.is_on_screen !== false &&
            item.on_current_space !== false,
        );
      if (observation?.window_bounds) {
        const window = { ...actions.target, bounds: observation.window_bounds };
        windows = windows.filter(
          (item) => String(item.window_id) !== String(window.window_id),
        );
        windows.push(window);
      }
      if (value) {
        const eligible = windows.filter(
          (item) =>
            !visibleWindows || visibleWindows.has(String(item.window_id)),
        );
        selected = desktopTarget(eligible, actions.target, selected).window;
        covered = desktopTarget(eligible, selected).covered;
        observedAt = Date.now();
      }
      start();
      heartbeat ??= setInterval(publish, 250);
      publish();
    },
    clear(expected) {
      if (!expected || expected === owner) clear();
    },
    async close() {
      closed = true;
      clear();
      if (child?.connected) child.disconnect();
      if (child && child.exitCode === null) {
        const stop = setTimeout(() => child.kill(), 2000);
        stop.unref();
        child.once("exit", () => clearTimeout(stop));
      }
    },
  };
}
