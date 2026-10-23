import { setTimeout } from "node:timers/promises";

export function openDesktopView(driver, id, activity) {
  let seq = 0;
  let waiting;
  let pointer;
  let closed = false;
  async function call(name, args, signal) {
    const result = await driver.callTool(
      name,
      JSON.stringify({
        ...args,
        session: id,
        target: { kind: "desktop", display_id: "primary" },
      }),
      { signal },
    );
    if (result.isError)
      throw new Error(result.text || "电脑输入未确认。请检查画面。");
  }
  return {
    async next(signal) {
      signal.throwIfAborted();
      if (closed) throw new Error("画面连接已断开。");
      if (waiting) {
        const abort = () => waiting?.reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        try {
          await waiting.promise;
        } finally {
          signal.removeEventListener("abort", abort);
        }
        await setTimeout(500, undefined, { signal });
      }
      signal.throwIfAborted();
      const result = await activity.capture(() =>
        driver.callTool(
          "get_desktop_state",
          JSON.stringify({ session: id, max_image_dimension: 1920 }),
          { signal },
        ),
      );
      const image = result.images[0];
      if (result.isError || !image)
        throw new Error(result.text || "当前图形会话无法提供画面。");
      const state = JSON.parse(result.structuredJson ?? "{}");
      waiting = Promise.withResolvers();
      void waiting.promise.catch(() => {});
      return {
        seq: ++seq,
        data: image.dataBase64,
        mimeType: image.mimeType,
        width: state.screenshot_width,
        height: state.screenshot_height,
        timestamp: Date.now(),
      };
    },
    async send(message, signal) {
      if (closed) throw new Error("画面连接已断开。");
      if (message.type === "navigate")
        throw new Error("桌面视图不支持网页导航。");
      if (message.type === "ack") {
        if (message.seq !== seq) throw new Error("画面确认已失效。");
        waiting?.resolve();
      } else if (message.type === "text")
        await call("type_text", { text: message.text }, signal);
      else if (message.type === "key") {
        const keys = [
          [1, "alt"],
          [2, "ctrl"],
          [4, "cmd"],
          [8, "shift"],
        ]
          .filter(([bit]) => message.modifiers & bit)
          .map(([, key]) => key);
        if (keys.length)
          await call("hotkey", { keys: [...keys, message.key] }, signal);
        else await call("press_key", { key: message.key }, signal);
      } else if (message.type === "pointer") {
        if (message.event === "down") pointer = message;
        if (message.event === "up") {
          const start = pointer;
          pointer = undefined;
          if (start && Math.hypot(start.x - message.x, start.y - message.y) > 3)
            await call(
              "drag",
              {
                from_x: start.x,
                from_y: start.y,
                to_x: message.x,
                to_y: message.y,
                button: message.button,
              },
              signal,
            );
          else
            await call(
              "click",
              { x: message.x, y: message.y, button: message.button },
              signal,
            );
        }
        if (message.event === "scroll")
          await call(
            "scroll",
            {
              x: message.x,
              y: message.y,
              direction: message.deltaY < 0 ? "up" : "down",
              amount: Math.max(1, Math.round(Math.abs(message.deltaY) / 40)),
            },
            signal,
          );
      }
    },
    close() {
      closed = true;
      waiting?.reject(new Error("画面连接已断开。"));
    },
  };
}
