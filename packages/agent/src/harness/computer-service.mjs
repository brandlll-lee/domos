import { openBrowserService } from "./browser-service.mjs";
import { openDesktopActivity } from "./desktop-activity.mjs";
import { openDesktopView } from "./desktop-view.mjs";

export function openComputerService(directory, home, emit = () => {}) {
  let desktop;
  let activity;
  const cursorSessions = new Set();
  let browser;
  const views = new Map();
  async function driver() {
    if (!desktop) {
      const { CuaDriver } = await import("@trycua/cua-driver");
      desktop = CuaDriver.create();
      activity = openDesktopActivity(desktop, emit);
    }
    return desktop;
  }
  return {
    async request(input, signal) {
      signal.throwIfAborted();
      if (input.operation === "activity") {
        activity?.clear(input.owner);
        return {};
      }
      if (input.service === "browser") {
        browser ??= openBrowserService(directory, home);
        const instance = await browser;
        if (input.operation === "view") {
          if (input.action === "open") {
            views.set(input.id, await instance.view(signal));
            return {};
          }
          const view = views.get(input.id);
          if (!view) throw new Error("画面连接已失效。");
          if (input.action === "next") return view.next(signal);
          if (input.action === "send") return view.send(input.message, signal);
          view.close();
          views.delete(input.id);
          return {};
        }
        if (input.operation === "catalog") return instance.catalog();
        if (input.operation === "install") return instance.install(signal);
        if (input.operation === "prepare") return instance.prepare(signal);
        return instance.call(input.name, input.arguments ?? {}, signal);
      }
      if (input.service !== "desktop") throw new Error("服务不可用。");
      const instance = await driver();
      if (input.operation === "view") {
        if (input.action === "open") {
          views.set(input.id, openDesktopView(instance, input.id, activity));
          return {};
        }
        const view = views.get(input.id);
        if (!view) throw new Error("画面连接已失效。");
        if (input.action === "next") return view.next(signal);
        if (input.action === "send") return view.send(input.message, signal);
        view.close();
        views.delete(input.id);
        return {};
      }
      if (input.operation === "catalog")
        return JSON.parse(await instance.listToolsJson({ signal })).tools;
      if (input.operation === "prepare") {
        try {
          const result = await activity.capture(() =>
            instance.callTool(
              "get_desktop_state",
              JSON.stringify({ max_image_dimension: 320 }),
              { signal },
            ),
          );
          return {
            available: !result.isError && result.images.length > 0,
            error:
              result.isError || !result.images.length
                ? result.text ||
                  "当前图形会话无法提供画面。请登录工作电脑并检查屏幕权限。"
                : null,
          };
        } catch (error) {
          return { available: false, error: error.message };
        }
      }
      const args = {
        ...input.arguments,
        session:
          input.arguments?.session ??
          `domos-${input.actor?.botId ?? "desktop"}`,
      };
      if (!cursorSessions.has(args.session)) {
        await instance
          .callTool(
            "set_agent_cursor_enabled",
            JSON.stringify({ session: args.session, enabled: false }),
            { signal },
          )
          .catch(() => {});
        cursorSessions.add(args.session);
      }
      activity.observe(input.name, args, null, input.actor);
      const call = () =>
        instance.callTool(input.name, JSON.stringify(args), { signal });
      const result = ["get_desktop_state", "get_window_state", "zoom"].includes(
        input.name,
      )
        ? await activity.capture(call)
        : await call();
      if (signal.aborted) activity.clear(input.actor?.owner);
      else activity.observe(input.name, args, result, input.actor);
      return {
        content: [
          ...(result.text ? [{ type: "text", text: result.text }] : []),
          ...result.images.map((image) => ({
            type: "image",
            mimeType: image.mimeType,
            data: image.dataBase64,
          })),
        ],
        ...(result.structuredJson
          ? { structuredContent: JSON.parse(result.structuredJson) }
          : {}),
        isError: result.isError,
      };
    },
    async close() {
      for (const view of views.values()) view.close();
      views.clear();
      if (browser)
        await browser.then((instance) => instance.close()).catch(() => {});
      if (!desktop) return;
      await activity.close();
      await desktop.shutdown();
      desktop.uniffiDestroy();
    },
  };
}
