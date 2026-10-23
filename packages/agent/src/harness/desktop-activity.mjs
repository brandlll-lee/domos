import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export function openDesktopActivity(driver, emit) {
  let actor;
  let owner;
  let target;
  let point;
  let child;
  let failed = false;
  let ready = false;
  let closed = false;
  let screen;
  let timer;
  let expiresAt = 0;
  let sequence = 0;
  let located;
  let generation = 0;
  let pending;
  let capturesInProgress = 0;
  let captureReady = Promise.resolve();
  const acknowledgements = new Map();
  const captures = new Map();
  const snapshots = new Map();
  const read = async (name, args = {}) => {
    const result = await driver.callTool(name, JSON.stringify(args), {
      signal: AbortSignal.timeout(1500),
    });
    if (result.isError) throw new Error("Desktop observation failed");
    return JSON.parse(result.structuredJson ?? "{}");
  };
  function send(value) {
    emit(value);
    if (ready && child?.stdin.writable && child.stdin.writableLength < 65536)
      child.stdin.write(`${JSON.stringify(value)}\n`);
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
        args.unshift("--no-sandbox");
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      child = spawn(executable, args, {
        env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "ignore"],
      });
      child.stdin.on("error", () => {});
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        try {
          const value = JSON.parse(line);
          if (value.type === "screen" && value.bounds) {
            screen = value.bounds;
            ready = true;
            if (capturesInProgress)
              child.stdin.write(
                `${JSON.stringify({ type: "capture", hidden: true })}\n`,
              );
          }
          if (value.type === "capture") acknowledgements.get(value.id)?.();
        } catch {}
      });
      child.on("error", () => {
        failed = true;
      });
      child.on("exit", () => {
        failed = true;
        ready = false;
        lines.close();
      });
    } catch {
      failed = true;
    }
  }
  function clear() {
    actor = target = point = undefined;
    generation++;
    clearTimeout(timer);
    timer = undefined;
    send(null);
  }
  async function tick() {
    if (!actor || closed || expiresAt <= Date.now()) return clear();
    const current = generation;
    try {
      const { windows = [] } = await read("list_windows");
      if (current !== generation || closed || !actor) return;
      let window =
        target &&
        windows.find(
          (item) =>
            String(item.window_id) === String(target.window_id) &&
            item.pid === target.pid &&
            item.is_on_screen !== false &&
            !item.minimized,
        );
      if (!screen) {
        const size = await read("get_screen_size");
        screen = { x: 0, y: 0, width: size.width, height: size.height };
      }
      if (current !== generation || closed || !actor) return;
      let pointer = null;
      if (point?.expiresAt > Date.now()) {
        const capture = captures.get(point.capture);
        const bounds = point.desktop ? screen : window?.bounds;
        if (bounds && capture)
          pointer = {
            ...point,
            x: bounds.x + (point.x * bounds.width) / capture.width,
            y: bounds.y + (point.y * bounds.height) / capture.height,
          };
      }
      if (pointer && point.desktop && located !== point.id) {
        located = point.id;
        window = windows
          .filter((item) => {
            const b = item.bounds;
            return (
              b &&
              item.is_on_screen !== false &&
              !item.minimized &&
              item.pid !== child?.pid &&
              pointer.x >= b.x &&
              pointer.y >= b.y &&
              pointer.x < b.x + b.width &&
              pointer.y < b.y + b.height
            );
          })
          .sort((a, b) => a.z_index - b.z_index)
          .at(-1);
        target = window && { pid: window.pid, window_id: window.window_id };
      }
      const covered = window
        ? windows
            .filter(
              (item) =>
                item.window_id !== window.window_id &&
                item.z_index > window.z_index &&
                item.is_on_screen !== false &&
                !item.minimized &&
                item.pid !== child?.pid,
            )
            .map((item) => item.bounds)
            .filter((b) => b && b.width > 0 && b.height > 0)
            .slice(0, 256)
        : [];
      send({
        ...actor,
        screen,
        window: window?.bounds ?? null,
        covered,
        pointer,
        expiresAt: Math.min(expiresAt, Date.now() + 2500),
      });
    } catch {
      if (current === generation) send(null);
    }
  }
  function schedule() {
    pending = tick().finally(() => {
      pending = undefined;
      if (actor && !closed)
        timer = setTimeout(() => {
          timer = undefined;
          schedule();
        }, 100);
    });
  }
  return {
    observe(name, args, result, identity) {
      if (closed || !identity || !/^#[0-9a-f]{6}$/i.test(identity.color))
        return;
      actor = { botId: identity.botId, color: identity.color };
      owner = identity.owner;
      expiresAt = Date.now() + 60000;
      const chosen = args.target?.kind === "window" ? args.target : args;
      if (chosen.pid !== undefined && chosen.window_id !== undefined)
        target = { pid: chosen.pid, window_id: chosen.window_id };
      if (args.element_token)
        target = snapshots.get(args.element_token.split(":")[0]) ?? target;
      if (result?.structuredJson) {
        try {
          const value = JSON.parse(result.structuredJson);
          if (value.snapshot_id && target)
            snapshots.set(value.snapshot_id, target);
          const width = value.screenshot_width;
          const height = value.screenshot_height;
          if (width > 0 && height > 0) {
            const key =
              value.capture_id ??
              (name === "get_desktop_state"
                ? "desktop"
                : String(target?.window_id));
            captures.set(key, { width, height });
            if (name === "get_desktop_state")
              captures.set("desktop", { width, height });
            else if (target)
              captures.set(String(target.window_id), { width, height });
          }
          if (snapshots.size > 32)
            snapshots.delete(snapshots.keys().next().value);
          if (captures.size > 64) captures.delete(captures.keys().next().value);
        } catch {}
      }
      if (
        !result &&
        ["click", "double_click", "move_cursor", "scroll", "drag"].includes(
          name,
        )
      ) {
        const desktop =
          args.target?.kind === "desktop" || args.scope === "desktop";
        const x = args.to_x ?? args.x;
        const y = args.to_y ?? args.y;
        point =
          !args.from_zoom && Number.isFinite(x) && Number.isFinite(y)
            ? {
                x,
                y,
                desktop,
                capture:
                  args.capture_id ??
                  (desktop ? "desktop" : String(target?.window_id)),
                action: name,
                id: ++sequence,
                expiresAt: Date.now() + 1500,
              }
            : null;
      }
      start();
      if (!timer && !pending) schedule();
    },
    async capture(run) {
      const overlay = child;
      const hidden = ++capturesInProgress;
      if (ready && overlay?.stdin.writable && hidden === 1) {
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
          overlay.stdin.write(
            `${JSON.stringify({ type: "capture", id, hidden: true })}\n`,
          );
        }).finally(() => acknowledgements.delete(id));
      }
      try {
        await captureReady;
        return await run();
      } finally {
        if (--capturesInProgress === 0 && overlay?.stdin.writable)
          overlay.stdin.write(
            `${JSON.stringify({ type: "capture", hidden: false })}\n`,
          );
      }
    },
    clear(expected) {
      if (!expected || expected === owner) clear();
    },
    async close() {
      closed = true;
      clear();
      await pending?.catch(() => {});
      child?.stdin.end();
      if (child && child.exitCode === null) {
        const stop = setTimeout(() => child.kill(), 2000);
        stop.unref();
        child.once("exit", () => clearTimeout(stop));
      }
    },
  };
}
