export function desktopTarget(windows, target, previous, pointer) {
  const front = (items) =>
    items.reduce(
      (best, item) => (!best || item.z_index > best.z_index ? item : best),
      undefined,
    );
  const candidates = windows.filter(
    (item) => item.bounds?.width >= 120 && item.bounds.height >= 120,
  );
  const exact =
    target?.window_id !== undefined &&
    candidates.find(
      (item) =>
        String(item.window_id) === String(target.window_id) &&
        (target.pid === undefined || item.pid === target.pid),
    );
  const app =
    target?.pid !== undefined &&
    front(candidates.filter((item) => item.pid === target.pid));
  const held =
    previous &&
    candidates.find(
      (item) =>
        item.pid === previous.pid && item.window_id === previous.window_id,
    );
  const pointed =
    pointer &&
    front(
      candidates.filter(
        ({ bounds: b }) =>
          pointer.x >= b.x &&
          pointer.y >= b.y &&
          pointer.x < b.x + b.width &&
          pointer.y < b.y + b.height,
      ),
    );
  const window = pointed || exact || app || (target ? undefined : held);
  const covered = window
    ? windows
        .filter((item) => item !== window && item.z_index > window.z_index)
        .map(({ bounds: b }) => {
          const x = Math.max(b?.x, window.bounds.x),
            y = Math.max(b?.y, window.bounds.y);
          return {
            x,
            y,
            width:
              Math.min(b?.x + b?.width, window.bounds.x + window.bounds.width) -
              x,
            height:
              Math.min(
                b?.y + b?.height,
                window.bounds.y + window.bounds.height,
              ) - y,
          };
        })
        .filter((b) => b.width > 0 && b.height > 0)
        .slice(0, 256)
    : [];
  return { window, covered };
}
