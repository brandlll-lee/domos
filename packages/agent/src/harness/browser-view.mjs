export async function openBrowserView(run, call, signal) {
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
  const socket = new WebSocket(
    `ws://127.0.0.1:${status.port}/?pacing=ack&maxFps=12`,
  );
  let latest;
  let pending;
  let failure;
  let delivered = 0;
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
      if (message.type === "ack") {
        if (message.seq !== delivered) throw new Error("画面确认已失效。");
        socket.send(JSON.stringify(message));
      } else if (message.type === "navigate") {
        const result = await call(
          "agent_browser_open",
          { url: message.url },
          signal,
        );
        if (result.isError) throw new Error("网页未能打开。请检查地址。");
      } else if (message.type === "text")
        socket.send(
          JSON.stringify({
            type: "input_keyboard",
            eventType: "char",
            text: message.text,
          }),
        );
      else if (message.type === "key") {
        const modifiers = [
          [1, "Alt"],
          [2, "Control"],
          [4, "Meta"],
          [8, "Shift"],
        ]
          .filter(([bit]) => message.modifiers & bit)
          .map(([, key]) => key);
        const result = await call(
          "agent_browser_press",
          { key: [...modifiers, message.key].join("+") },
          signal,
        );
        if (result.isError) throw new Error("按键未确认。请检查页面。");
      } else if (message.type === "pointer") {
        socket.send(
          JSON.stringify({
            type: "input_mouse",
            eventType: {
              down: "mousePressed",
              up: "mouseReleased",
              move: "mouseMoved",
              scroll: "mouseWheel",
            }[message.event],
            x: message.x,
            y: message.y,
            button: message.button,
            clickCount: 1,
            deltaX: message.deltaX,
            deltaY: message.deltaY,
          }),
        );
      }
    },
    close() {
      socket.close();
      fail();
    },
  };
}
