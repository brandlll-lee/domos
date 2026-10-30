export const desktopInputs = [
  "click",
  "double_click",
  "right_click",
  "set_value",
  "type_text",
  "press_key",
  "hotkey",
  "scroll",
  "drag",
  "move_cursor",
];

const desktopMaintenance = new Set([
  "get_config",
  "set_config",
  "get_recording_state",
  "start_recording",
  "stop_recording",
  "replay_trajectory",
  "check_for_update",
  "install_ffmpeg",
  "check_permissions",
  "health_report",
  "debug_window_info",
  "get_agent_cursor_state",
  "set_agent_cursor_enabled",
  "set_agent_cursor_motion",
  "set_agent_cursor_style",
  "set_agent_cursor_theme",
  "get_session",
  "list_sessions",
  "get_session_state",
  "escalate_session",
]);

export function desktopToolListed(name, browser) {
  return (
    !desktopMaintenance.has(name) &&
    !(
      browser &&
      (name.startsWith("browser_") ||
        ["get_browser_state", "page"].includes(name))
    )
  );
}

export function desktopStep(step) {
  const tool =
    step.tool ?? Object.keys(step).find((key) => desktopInputs.includes(key));
  return { tool, args: step.args ?? step[tool] };
}

export function openDesktopActions() {
  const snapshots = new Map(),
    captures = new Map();
  let target,
    point,
    session,
    sequence = 0,
    batchSequence = 0;
  const key = (id, owner = session) => `${owner ?? ""}:${id}`;
  function snapshot(args) {
    return snapshots.get(
      key(args.snapshot_id ?? args.element_token?.split(":")[0], args.session),
    );
  }
  function resolve(args) {
    const chosen = args.target?.kind === "window" ? args.target : args;
    return (
      snapshot(args)?.target ??
      (chosen.pid !== undefined || chosen.window_id !== undefined
        ? { pid: chosen.pid, window_id: chosen.window_id }
        : undefined)
    );
  }
  function observe(name, args, value) {
    session = args.session ?? "";
    target = resolve(args) ?? target;
    if (name === "run_script") {
      return;
    }
    if (name === "run_steps") {
      if (!value) {
        batchSequence = sequence;
        return;
      }
      const completed = (value.steps ?? []).filter((step) => step.ok).at(-1);
      if (completed && sequence === batchSequence) {
        const step = desktopStep(args.steps[completed.index]);
        if (step.args)
          observe(
            step.tool,
            { ...args, ...step.args, ...completed.target?.window },
            null,
          );
        if (point) point.action = "move_cursor";
      }
      if (value.observation?.ok)
        observe("get_window_state", args, value.observation.state);
      return;
    }
    if (value) {
      if (value.pid !== undefined || value.window_id !== undefined)
        target = { pid: value.pid, window_id: value.window_id };
      if (value.snapshot_id && target)
        snapshots.set(key(value.snapshot_id), {
          target,
          bounds: value.window_bounds,
          elements: new Map(
            (value.elements ?? []).map((e) => [e.element_token, e.frame]),
          ),
        });
      if (value.screenshot_width > 0 && value.screenshot_height > 0) {
        const capture = {
          width: value.screenshot_width,
          height: value.screenshot_height,
        };
        captures.set(
          key(name === "get_desktop_state" ? "desktop" : target?.window_id),
          capture,
        );
        if (value.capture_id) captures.set(key(value.capture_id), capture);
      }
      if (snapshots.size > 32) snapshots.delete(snapshots.keys().next().value);
      if (captures.size > 64) captures.delete(captures.keys().next().value);
      return;
    }
    if (!desktopInputs.includes(name)) return;
    const saved = snapshot(args),
      frame = saved?.elements.get(args.element_token);
    if (frame?.w > 0 && frame?.h > 0)
      point = {
        x: frame.x + frame.w / 2,
        y: frame.y + frame.h / 2,
        bounds: saved.bounds,
        space: "screen",
      };
    else {
      const x = args.to_x ?? args.x,
        y = args.to_y ?? args.y;
      if (
        ![
          "click",
          "double_click",
          "right_click",
          "move_cursor",
          "scroll",
          "drag",
        ].includes(name)
      )
        return;
      const desktop =
        args.target?.kind === "desktop" || args.scope === "desktop";
      point =
        !args.from_zoom && Number.isFinite(x) && Number.isFinite(y)
          ? {
              x,
              y,
              desktop,
              capture: captures.get(
                key(
                  args.capture_id ?? (desktop ? "desktop" : target?.window_id),
                ),
              ),
              space: name === "move_cursor" && !desktop ? "logical" : "capture",
            }
          : undefined;
    }
    if (point) Object.assign(point, { target, action: name, id: ++sequence });
  }
  return {
    get target() {
      return target;
    },
    set target(value) {
      target = value;
    },
    observe,
    pointer(window, screen, physical = (point) => point) {
      if (!point) return null;
      const bounds = window?.bounds;
      if (point.space === "logical") return { ...point, ...physical(point) };
      if (
        !point.desktop &&
        (!window ||
          (point.target?.pid !== undefined &&
            point.target.pid !== window.pid) ||
          (point.target?.window_id !== undefined &&
            String(point.target.window_id) !== String(window.window_id)))
      )
        return null;
      const source = point.space === "screen" ? point.bounds : point.capture;
      const area = point.desktop ? screen : bounds;
      if (!area || !source) return point.space === "screen" ? point : null;
      return {
        ...point,
        x:
          area.x +
          ((point.x - (point.space === "screen" ? source.x : 0)) * area.width) /
            source.width,
        y:
          area.y +
          ((point.y - (point.space === "screen" ? source.y : 0)) *
            area.height) /
            source.height,
      };
    },
    clear() {
      target = point = session = undefined;
      snapshots.clear();
      captures.clear();
    },
  };
}
