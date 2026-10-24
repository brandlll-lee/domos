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

export function desktopStep(step) {
  const tool =
    step.tool ?? Object.keys(step).find((key) => desktopInputs.includes(key));
  return { tool, args: step.args ?? step[tool] };
}

export function openDesktopActions() {
  const captures = new Map();
  const snapshots = new Map();
  let target;
  let point;
  let sequence = 0;
  function resolve(args) {
    const snapshot = snapshots.get(
      `${args.session ?? ""}:${args.element_token?.split(":")[0]}`,
    );
    const chosen = args.target?.kind === "window" ? args.target : args;
    return (
      snapshot?.target ??
      (chosen.pid !== undefined || chosen.window_id !== undefined
        ? { pid: chosen.pid, window_id: chosen.window_id }
        : undefined)
    );
  }
  function observe(name, args, value) {
    const session = args.session ?? "";
    const key = (id) => `${session}:${id}`;
    target = resolve(args) ?? target;
    if (name === "run_steps") {
      if (!value) return;
      const completed = (value.steps ?? []).filter((step) => step.ok).at(-1);
      if (completed) {
        const { tool, args: input } = desktopStep(args.steps[completed.index]);
        if (input)
          observe(
            tool,
            { ...args, ...input, ...(completed.target?.window ?? {}) },
            undefined,
          );
      }
      if (value?.observation?.ok)
        observe("get_window_state", args, value.observation.state);
      return;
    }
    const snapshot = snapshots.get(key(args.element_token?.split(":")[0]));
    if (value) {
      if (value.pid !== undefined || value.window_id !== undefined)
        target = { pid: value.pid, window_id: value.window_id };
      if (value.snapshot_id && target) {
        snapshots.set(key(value.snapshot_id), {
          target,
          bounds: value.window_bounds,
          elements: new Map(
            (value.elements ?? []).map((element) => [
              element.element_token,
              element.frame,
            ]),
          ),
        });
      }
      const { screenshot_width: width, screenshot_height: height } = value;
      if (width > 0 && height > 0) {
        const id =
          name === "get_desktop_state" ? "desktop" : String(target?.window_id);
        captures.set(key(id), { width, height });
        if (value.capture_id)
          captures.set(key(value.capture_id), { width, height });
      }
      if (snapshots.size > 32) snapshots.delete(snapshots.keys().next().value);
      if (captures.size > 64) captures.delete(captures.keys().next().value);
      return;
    }
    const frame = snapshot?.elements.get(args.element_token);
    const x = args.to_x ?? args.x;
    const y = args.to_y ?? args.y;
    if (frame?.w > 0 && frame?.h > 0 && snapshot.bounds) {
      point = {
        x: frame.x + frame.w / 2,
        y: frame.y + frame.h / 2,
        bounds: snapshot.bounds,
        element: true,
      };
    } else if (
      [
        "click",
        "double_click",
        "right_click",
        "move_cursor",
        "scroll",
        "drag",
      ].includes(name)
    ) {
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
                  args.capture_id ??
                    (desktop ? "desktop" : String(target?.window_id)),
                ),
              ),
              absolute: name === "move_cursor" && !desktop,
            }
          : undefined;
    } else return;
    if (point)
      Object.assign(point, {
        target,
        action: name,
        id: ++sequence,
        expiresAt: Date.now() + 15000,
      });
  }
  return {
    get target() {
      return target;
    },
    set target(value) {
      target = value;
    },
    observe,
    resolve,
    pointer(bounds, screen, physical = (point) => point) {
      if (!point || point.expiresAt <= Date.now()) return null;
      if (
        !point.desktop &&
        !point.absolute &&
        (point.target?.pid !== target?.pid ||
          point.target?.window_id !== target?.window_id)
      )
        return null;
      if (point.absolute) return { ...point, ...physical(point) };
      if (point.element) {
        if (!bounds) return null;
        const position = physical(point);
        return {
          ...point,
          x:
            bounds.x +
            ((position.x - point.bounds.x) * bounds.width) / point.bounds.width,
          y:
            bounds.y +
            ((position.y - point.bounds.y) * bounds.height) /
              point.bounds.height,
        };
      }
      const area = point.desktop ? screen : bounds;
      return area && point.capture
        ? {
            ...point,
            x: area.x + (point.x * area.width) / point.capture.width,
            y: area.y + (point.y * area.height) / point.capture.height,
          }
        : null;
    },
    clear() {
      target = point = undefined;
    },
  };
}
