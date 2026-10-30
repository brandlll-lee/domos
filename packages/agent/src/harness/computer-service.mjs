import { openBrowserService } from "./browser-service.mjs";
import { openDesktopView } from "./desktop-view.mjs";

export function openComputerService(directory, home, emit = () => {}) {
  let desktop;
  let starting;
  let activity;
  let desktopTools;
  let browser;
  const views = new Map();
  async function driver() {
    starting ??= (async () => {
      const { CuaDriver } = await import("@trycua/cua-driver");
      const { openDesktopActivity } = await import("./desktop-activity.mjs");
      desktop = CuaDriver.create();
      desktopTools = JSON.parse(await desktop.listToolsJson()).tools;
      activity = openDesktopActivity(emit);
      return desktop;
    })().catch((error) => {
      starting = undefined;
      throw error;
    });
    return starting;
  }
  return {
    async request(input, signal) {
      signal.throwIfAborted();
      if (input.operation === "activity") {
        activity?.clear(input.owner);
        return {};
      }
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
      const startedAt = performance.now();
      try {
        activity.observe(input.name, args, null, input.actor);
      } catch {}
      const result = await instance.callTool(input.name, JSON.stringify(args), {
        signal,
      });
      const elapsed = Math.round(performance.now() - startedAt);
      try {
        if (signal.aborted) activity.clear(input.actor?.owner);
        else activity.observe(input.name, args, result, input.actor);
      } catch {}
      const native = result.rawJson
        ? JSON.parse(result.rawJson)
        : {
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
            isError: Boolean(result.isError),
          };
      return {
        ...native,
        isError: Boolean(native.isError),
        _meta: { ...native._meta, "domos/platform": process.platform },
        content: [
          ...native.content,
          {
            type: "text",
            text: `Domos computer tool time: ${elapsed} ms.`,
          },
        ],
      };
    },
    async close() {
      for (const view of views.values()) await view.close();
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
