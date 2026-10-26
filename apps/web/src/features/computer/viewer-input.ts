import type { ViewerAction } from "@domos/agent/computer/viewer-types";

export function viewportPoint(
  image: { naturalWidth: number; naturalHeight: number },
  rect: { left: number; top: number; width: number; height: number },
  frame: { width: number; height: number },
  x: number,
  y: number,
  browser: boolean,
  captured = false,
) {
  if (
    ![
      image.naturalWidth,
      image.naturalHeight,
      rect.width,
      rect.height,
      frame.width,
      frame.height,
    ].every((n) => Number.isFinite(n) && n > 0)
  )
    return;
  // Chrome can report window height while the image contains only the page.
  const depicted = (image.naturalHeight * frame.width) / image.naturalWidth;
  const height =
    browser &&
    Math.abs(depicted - frame.height) >
      Math.max(1, frame.width / image.naturalWidth)
      ? Math.round(depicted)
      : frame.height;
  const scale = Math.min(
    rect.width / image.naturalWidth,
    rect.height / image.naturalHeight,
  );
  const width = image.naturalWidth * scale;
  const visibleHeight = image.naturalHeight * scale;
  x -= rect.left + (rect.width - width) / 2;
  y -= rect.top + (rect.height - visibleHeight) / 2;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    (!captured && (x < 0 || y < 0 || x >= width || y >= visibleHeight))
  )
    return;
  return {
    x: Math.max(
      0,
      Math.min(frame.width - 1, Math.round((x * frame.width) / width)),
    ),
    y: Math.max(
      0,
      Math.min(height - 1, Math.round((y * height) / visibleHeight)),
    ),
  };
}

const movement = (action: ViewerAction) =>
  action.type === "pointer" && action.event === "move";
const recovery = (action: ViewerAction) =>
  action.type === "back" ||
  (action.type === "pointer" && action.event === "cancel");

export function viewerQueue(
  dispatch: (action: ViewerAction) => Promise<void>,
  failed: (error: unknown) => void,
) {
  type Entry = { action: ViewerAction; done: (value: boolean) => void };
  const entries: Entry[] = [];
  let running = false;
  let stopped = false;
  const halt = (error: unknown) => {
    stopped = true;
    failed(error);
  };
  const run = async () => {
    if (running) return;
    running = true;
    try {
      while (entries.length) {
        const entry = entries.shift();
        if (!entry) break;
        if (stopped && !recovery(entry.action)) {
          entry.done(false);
          continue;
        }
        try {
          await dispatch(entry.action);
          entry.done(true);
        } catch (error) {
          halt(error);
          entry.done(false);
        }
      }
    } finally {
      running = false;
    }
  };
  return (action: ViewerAction): Promise<boolean> => {
    if (stopped && !recovery(action)) return Promise.resolve(false);
    const last = entries.at(-1);
    if (last && movement(action) && movement(last.action)) {
      last.done(false);
      entries.pop();
    }
    if (entries.length >= 32 && !recovery(action)) {
      halt(new Error("输入速度超过连接处理能力。请检查页面后重新连接。"));
      return Promise.resolve(false);
    }
    return new Promise((done) => {
      entries.push({ action, done });
      void run();
    });
  };
}
