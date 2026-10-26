import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function browserProcess(profile, signal) {
  const [port, path] = (
    await readFile(join(profile, "DevToolsActivePort"), "utf8")
  )
    .trim()
    .split(/\r?\n/);
  if (
    !/^\d+$/.test(port) ||
    Number(port) < 1 ||
    Number(port) > 65535 ||
    !path?.startsWith("/devtools/browser/")
  )
    throw new Error("浏览器窗口身份未确认。");
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
  timeout.throwIfAborted();
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  const fail = () => socket.close();
  timeout.addEventListener("abort", fail, { once: true });
  try {
    return await new Promise((resolve, reject) => {
      const fail = () => reject(new Error("浏览器窗口身份未确认。"));
      socket.addEventListener("error", fail, { once: true });
      socket.addEventListener("close", fail, { once: true });
      socket.addEventListener(
        "open",
        () =>
          socket.send(
            JSON.stringify({ id: 1, method: "SystemInfo.getProcessInfo" }),
          ),
        { once: true },
      );
      socket.addEventListener("message", ({ data }) => {
        try {
          const message = JSON.parse(data);
          if (message.id !== 1) return;
          const pid = message.result?.processInfo?.find(
            (p) => p.type === "browser",
          )?.id;
          if (!Number.isSafeInteger(pid) || pid < 1) return fail();
          resolve(pid);
        } catch {
          fail();
        }
      });
    });
  } finally {
    timeout.removeEventListener("abort", fail);
    socket.close();
  }
}

export function browserPagePoint(window, frame, x, y) {
  const values = [
    window.width,
    window.height,
    window.innerWidth,
    window.innerHeight,
    frame.width,
    frame.height,
    x,
    y,
  ];
  if (
    !values.every(Number.isFinite) ||
    values.slice(0, 6).some((value) => value <= 0)
  )
    throw new Error("浏览器画面尺寸未确认。");
  // shortcut: page hover assumes standard Chrome borders; use native viewport bounds for side-panel layouts.
  const border = (window.width - window.innerWidth) / 2;
  x = (x * window.width) / frame.width - border;
  y =
    (y * window.height) / frame.height -
    (window.height - window.innerHeight - border);
  if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight)
    return;
  return { x: Math.round(x), y: Math.round(y) };
}
