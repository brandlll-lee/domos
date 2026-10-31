import { browserCommand } from "./browser-command.mjs";

export async function openBrowserView(run, signal, ready, input, session) {
  const response = JSON.parse(
    await run(["stream", "status", "--json"], signal),
  );
  const status = response.data ?? response;
  if (
    !status.enabled ||
    !Number.isInteger(status.port) ||
    status.port < 1 ||
    status.port > 65535
  )
    throw new Error("浏览器画面服务未开启。");
  const identity = await browserCommand(
    status.port,
    { action: "session_info" },
    signal,
  );
  if (identity.session !== session) throw new Error("浏览器会话已改变。");
  const socket = new WebSocket(
    `ws://127.0.0.1:${status.port}/?pacing=ack&maxFps=30`,
  );
  let latest;
  let pending;
  let failure;
  let delivered = 0;
  let pointer;
  const fail = () => {
    failure = new Error("画面连接已断开。请重新连接。");
    pending?.reject(failure);
  };
  socket.addEventListener("error", fail);
  socket.addEventListener("close", fail);
  socket.addEventListener("message", ({ data }) => {
    try {
      if (typeof data !== "string" || data.length > 4 * 1024 * 1024) return;
      const frame = JSON.parse(data);
      if (
        frame.type !== "frame" ||
        typeof frame.data !== "string" ||
        !Number.isSafeInteger(frame.seq)
      )
        return;
      latest = {
        seq: frame.seq,
        data: frame.data,
        mimeType: "image/jpeg",
        width: frame.metadata.deviceWidth,
        height: frame.metadata.deviceHeight,
        timestamp: frame.metadata.timestamp,
      };
      pending?.resolve();
    } catch {
      fail();
    }
  });
  try {
    signal.throwIfAborted();
    await new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      const clean = () => signal.removeEventListener("abort", abort);
      socket.addEventListener(
        "open",
        () => {
          clean();
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clean();
          reject(new Error("浏览器画面未能连接。"));
        },
        { once: true },
      );
      socket.addEventListener(
        "close",
        () => {
          clean();
          reject(new Error("浏览器画面已断开。"));
        },
        { once: true },
      );
    });
  } catch (error) {
    socket.close();
    throw error;
  }
  return {
    async next(signal) {
      signal.throwIfAborted();
      if (failure) throw failure;
      if (!latest) {
        pending = Promise.withResolvers();
        const abort = () => pending?.reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        try {
          await pending.promise;
        } finally {
          signal.removeEventListener("abort", abort);
          pending = undefined;
        }
      }
      signal.throwIfAborted();
      const frame = latest;
      latest = undefined;
      delivered = frame.seq;
      return frame;
    },
    async send(message, signal) {
      if (failure) throw failure;
      const send = (command) => input(command, signal, status.port);
      const release = async (cancelled = false) => {
        if (!pointer) return;
        await send({
          action: "input_mouse",
          type: "mouseReleased",
          x: cancelled ? -1 : pointer.x,
          y: cancelled ? -1 : pointer.y,
          button: pointer.button,
          clickCount: 1,
        });
        pointer = undefined;
      };
      if (message.type !== "ack") await ready();
      if (
        message.type === "back" ||
        (message.type === "pointer" && message.event === "cancel")
      ) {
        await release(true);
      } else if (message.type === "ack") {
        if (message.seq !== delivered) throw new Error("画面确认已失效。");
        socket.send(JSON.stringify({ type: "ack", seq: message.seq }));
        if (message.maxFps)
          socket.send(
            JSON.stringify({ type: "config", maxFps: message.maxFps }),
          );
      } else if (message.type === "text") {
        await send({
          action: "keyboard",
          subaction: "insertText",
          text: message.text,
        });
      } else if (message.type === "key") {
        if (message.modifiers === 4 && message.key.toLowerCase() === "a") {
          await send({ action: "selectall", selector: ":focus" });
          return;
        }
        const modifiers = [
          [1, "Alt"],
          [2, "Control"],
          [4, "Meta"],
          [8, "Shift"],
        ]
          .filter(([bit]) => message.modifiers & bit)
          .map(([, key]) => key);
        await send({
          action: "press",
          key: [...modifiers, message.key].join("+"),
        });
      } else if (message.type === "pointer") {
        const position = { x: Math.round(message.x), y: Math.round(message.y) };
        if (message.event === "up") {
          if (pointer) pointer = { ...pointer, ...position };
          await release();
        } else {
          if (message.event === "down")
            pointer = { ...position, button: message.button };
          if (pointer) pointer = { ...pointer, ...position };
          await send({
            action: "input_mouse",
            type:
              message.event === "down"
                ? "mousePressed"
                : message.event === "scroll"
                  ? "mouseWheel"
                  : "mouseMoved",
            ...position,
            modifiers: message.modifiers ?? 0,
            button: pointer?.button ?? "none",
            clickCount: 1,
            ...(message.event === "scroll"
              ? {
                  deltaX: Math.round(message.deltaX),
                  deltaY: Math.round(message.deltaY),
                }
              : {}),
          });
        }
      }
    },
    async close() {
      try {
        if (pointer) {
          await input(
            {
              action: "input_mouse",
              type: "mouseReleased",
              x: -1,
              y: -1,
              button: pointer.button,
              clickCount: 1,
            },
            AbortSignal.timeout(30000),
            status.port,
          );
          pointer = undefined;
        }
      } finally {
        socket.close();
        fail();
      }
    },
  };
}
