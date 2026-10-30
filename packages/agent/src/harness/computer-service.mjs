import { openBrowserService } from "./browser-service.mjs";
import { desktopStep } from "./desktop-actions.mjs";
import { openDesktopSession } from "./desktop-session.mjs";
import { openDesktopView } from "./desktop-view.mjs";

export function openComputerService(directory, home, emit = () => {}) {
  let desktop;
  let starting;
  let activity;
  let sessions;
  let desktopTools;
  let browser;
  const views = new Map();
  async function driver() {
    starting ??= (async () => {
      const { CuaDriver } = await import("@trycua/cua-driver");
      const { openDesktopActivity } = await import("./desktop-activity.mjs");
      desktop = CuaDriver.create();
      desktopTools = JSON.parse(await desktop.listToolsJson()).tools;
      sessions = openDesktopSession(desktop, desktopTools);
      activity = openDesktopActivity(desktop, emit);
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
        sessions?.clear(input.owner);
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
      if (input.operation === "view") {
        if (input.action === "open") {
          views.set(input.id, openDesktopView(instance, input.id, activity));
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
        ...(input.arguments?.observe
          ? { observe: { ...input.arguments.observe } }
          : {}),
        session:
          input.arguments?.session ??
          `domos-${input.actor?.botId ?? "desktop"}`,
      };
      const send = (name, args) =>
        sessions.call(name, args, input.actor?.owner, signal);
      if (input.name === "run_steps") {
        args.observe ??= {};
        args.observe.include_screenshot ??= (args.steps ?? []).some((step) => {
          const action = desktopStep(step).args ?? {};
          return (
            action.x !== undefined ||
            action.y !== undefined ||
            action.from_x !== undefined ||
            (action.delivery_mode ?? args.delivery_mode) === "foreground"
          );
        });
      }
      if (
        input.name === "run_steps" &&
        [
          args,
          ...(args.steps ?? []).map((step) => desktopStep(step).args ?? {}),
        ].some(
          (target) =>
            !target.app &&
            !target.window &&
            (target.pid !== undefined) !== (target.window_id !== undefined),
        )
      )
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Batch target requires both pid and window_id, or app/window names. Discover and confirm the target window before input. No batch action was sent.",
            },
          ],
        };
      activity.observe(input.name, args, null, input.actor);
      const call = () => send(input.name, args);
      const startedAt = performance.now();
      const result =
        ["get_desktop_state", "zoom", "run_steps"].includes(input.name) ||
        (input.name === "get_window_state" &&
          (args.include_screenshot !== false || args.screenshot_out_file))
          ? await activity.capture(call)
          : await call();
      if (signal.aborted) activity.clear(input.actor?.owner);
      else {
        activity.observe(input.name, args, result, input.actor);
      }
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
            text: `Domos computer tool time: ${Math.round(performance.now() - startedAt)} ms.`,
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
