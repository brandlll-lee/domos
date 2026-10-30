import { openBrowserService } from "./browser-service.mjs";
import { openDesktopDriver } from "./desktop-driver.mjs";
import { openDesktopView } from "./desktop-view.mjs";

export function openComputerService(directory, home) {
  let desktop;
  let starting;
  let desktopTools;
  let browser;
  const views = new Map();
  async function driver() {
    starting ??= (async () => {
      desktop = await openDesktopDriver(home);
      desktopTools = (await desktop.client.listTools()).tools;
      return desktop.driver;
    })().catch((error) => {
      starting = undefined;
      throw error;
    });
    return starting;
  }
  return {
    async request(input, signal) {
      signal.throwIfAborted();
      if (input.service === "browser") {
        if (input.operation === "settle" && !browser) return {};
        if (!browser) {
          browser = openBrowserService(directory, home);
          void browser.catch(() => {
            browser = undefined;
          });
        }
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
          await view.close();
          views.delete(input.id);
          return {};
        }
        if (input.operation === "settle") return instance.settle();
        if (input.operation === "catalog") return instance.catalog();
        if (input.operation === "install") return instance.install(signal);
        if (input.operation === "prepare") return instance.prepare(signal);
        if (input.operation === "mode") {
          return instance.mode(input.mode, signal);
        }
        return instance.call(input.name, input.arguments ?? {}, signal);
      }
      if (input.service !== "desktop") throw new Error("服务不可用。");
      const instance = await driver();
      signal.throwIfAborted();
      if (input.operation === "view") {
        if (input.action === "open") {
          views.set(input.id, openDesktopView(instance, input.id));
          return {};
        }
        const view = views.get(input.id);
        if (!view) throw new Error("画面连接已失效。");
        if (input.action === "next") return view.next(signal);
        if (input.action === "send") return view.send(input.message, signal);
        await view.close();
        views.delete(input.id);
        return {};
      }
      if (input.operation === "catalog") return desktopTools;
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
      const args = input.arguments ?? {};
      const native = await desktop.client.callTool(
        { name: input.name, arguments: args },
        undefined,
        { signal },
      );
      return {
        ...native,
        isError: Boolean(native.isError),
        _meta: { ...native._meta, "domos/platform": process.platform },
      };
    },
    async close() {
      for (const view of views.values()) await view.close();
      views.clear();
      if (browser)
        await browser.then((instance) => instance.close()).catch(() => {});
      if (!desktop) return;
      await desktop.close();
    },
  };
}
