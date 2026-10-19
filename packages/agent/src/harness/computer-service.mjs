import { openBrowserService } from "./browser-service.mjs";
import { openDesktopView } from "./desktop-view.mjs";

export function openComputerService(directory, home) {
  let desktop;
  let browser;
  const views = new Map();
  async function driver() {
    if (!desktop) {
      const { CuaDriver } = await import("@trycua/cua-driver");
      desktop = CuaDriver.create();
    }
    return desktop;
  }
  return {
    async request(input, signal) {
      signal.throwIfAborted();
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
          views.set(input.id, openDesktopView(instance, input.id));
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
          const result = await instance.callTool(
            "get_desktop_state",
            JSON.stringify({ max_image_dimension: 320 }),
            { signal },
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
      const result = await instance.callTool(
        input.name,
        JSON.stringify(input.arguments ?? {}),
        { signal },
      );
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
      await desktop.shutdown();
      desktop.uniffiDestroy();
    },
  };
}
