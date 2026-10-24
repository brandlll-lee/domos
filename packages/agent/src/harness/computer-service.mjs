import { openBrowserService } from "./browser-service.mjs";
import { desktopInputs, desktopStep } from "./desktop-actions.mjs";
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
      const { openDesktopActivity } = await import("./desktop-activity.mjs");
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
        ...(input.arguments?.observe
          ? { observe: { ...input.arguments.observe } }
          : {}),
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
      const foreground =
        input.name === "run_steps"
          ? args.steps
              ?.map((step) => ({
                ...args,
                ...desktopStep(step).args,
              }))
              .find((step) => step.delivery_mode === "foreground")
          : args.delivery_mode === "foreground" &&
              desktopInputs.includes(input.name)
            ? args
            : undefined;
      const target = foreground && activity.target(foreground);
      const activation =
        target?.pid !== undefined && !activity.active(target)
          ? await instance.callTool(
              "bring_to_front",
              JSON.stringify({ ...target, session: args.session }),
              { signal },
            )
          : undefined;
      signal.throwIfAborted();
      const reading =
        input.name === "get_window_state"
          ? args
          : input.name === "run_steps"
            ? args.observe
            : undefined;
      const format = reading?.tree_format ?? "markdown";
      const batchCapture =
        input.name === "run_steps" &&
        reading?.include_screenshot &&
        !activity.captureExcluded;
      if (batchCapture) reading.include_screenshot = false;
      if (reading && !reading.since && !reading.full_output) {
        if (format === "markdown") reading.tree_format = "both";
        if (input.name === "run_steps") reading.since = null;
      }
      const call = () =>
        instance.callTool(input.name, JSON.stringify(args), { signal });
      const result = activation?.isError
        ? activation
        : ["get_desktop_state", "zoom"].includes(input.name) ||
            (input.name === "get_window_state" &&
              (args.include_screenshot !== false || args.screenshot_out_file))
          ? await activity.capture(call)
          : await call();
      if (signal.aborted) activity.clear(input.actor?.owner);
      else {
        activity.observe(input.name, args, result, input.actor);
      }
      const structured = result.structuredJson
        ? JSON.parse(result.structuredJson)
        : undefined;
      if (structured && input.name === "get_window_state")
        structured.platform = process.platform;
      let images = result.images;
      let captureError;
      const observed = structured?.observation?.state;
      if (batchCapture && observed && !signal.aborted) {
        const captured = await activity.capture(() =>
          instance.callTool(
            "get_window_state",
            JSON.stringify({
              ...reading,
              pid: observed.pid,
              window_id: observed.window_id,
              session: args.session,
              include_accessibility_tree: false,
              include_screenshot: true,
            }),
            { signal },
          ),
        );
        images = captured.images;
        captureError = captured.isError ? captured.text : undefined;
        const capture = JSON.parse(captured.structuredJson ?? "{}");
        Object.assign(observed, capture);
        if (signal.aborted) activity.clear(input.actor?.owner);
        else activity.observe("get_window_state", args, captured, input.actor);
      }
      if (
        reading &&
        format === "markdown" &&
        !input.arguments?.full_output &&
        !input.arguments?.observe?.full_output &&
        structured
      ) {
        const state =
          input.name === "run_steps"
            ? structured.observation?.state
            : structured;
        if (state) {
          delete state.elements;
          state.tree_format = "markdown";
        }
      }
      return {
        content: [
          ...(result.text ? [{ type: "text", text: result.text }] : []),
          ...(captureError ? [{ type: "text", text: captureError }] : []),
          ...images.map((image) => ({
            type: "image",
            mimeType: image.mimeType,
            data: image.dataBase64,
          })),
        ],
        ...(structured ? { structuredContent: structured } : {}),
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
