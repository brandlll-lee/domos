import { openBrowserService } from "./browser-service.mjs";
import { desktopInputs, desktopStep } from "./desktop-actions.mjs";
import { openDesktopSession } from "./desktop-session.mjs";
import { openDesktopView } from "./desktop-view.mjs";

export function openComputerService(directory, home, emit = () => {}) {
  let desktop;
  let activity;
  let sessions;
  let browser;
  const views = new Map();
  async function driver() {
    if (!desktop) {
      const { CuaDriver } = await import("@trycua/cua-driver");
      const { openDesktopActivity } = await import("./desktop-activity.mjs");
      desktop = CuaDriver.create();
      sessions = openDesktopSession(desktop);
      activity = openDesktopActivity(desktop, emit);
    }
    return desktop;
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
        return JSON.parse(await instance.listToolsJson({ signal })).tools.map(
          (tool) => ({
            ...tool,
            description:
              tool.name === "run_steps"
                ? `${tool.description}\nWait for a known UI state with a check-only batch: {pid,window_id,steps:[{wait_for:{text:"Ready",timeout_ms:5000}}],observe:{}}. wait_for is a step field, not a tool. Use expect after important input or submission. Never use shell sleeps to wait for UI state.`
                : tool.name === "type_text"
                  ? `${tool.description}\nPrefer set_value for accessible text fields. Delivery alone does not verify input; check the value or resulting UI before continuing.`
                  : tool.description,
          }),
        );
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
          ? await send("bring_to_front", { ...target, session: args.session })
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
      if (reading && !reading.full_output) {
        if (input.name === "run_steps" && reading.since === undefined)
          reading.since = "latest";
        if (!reading.since && format === "markdown")
          reading.tree_format = "both";
      }
      const call = () => send(input.name, args);
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
          send("get_window_state", {
            ...reading,
            pid: observed.pid,
            window_id: observed.window_id,
            session: args.session,
            include_accessibility_tree: false,
            include_screenshot: true,
          }),
        );
        images = captured.images;
        captureError = captured.isError ? captured.text : undefined;
        const capture = JSON.parse(captured.structuredJson ?? "{}");
        if (!captured.isError) Object.assign(observed, capture);
        else
          structured.observation = {
            ...structured.observation,
            ok: false,
            error: captured.text,
          };
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
      const delivered = sessions.images(
        args.session,
        input.actor?.owner,
        observed ? "get_window_state" : input.name,
        observed ?? structured,
        images,
      );
      const action =
        desktopInputs.includes(input.name) ||
        (input.name === "run_steps" &&
          args.steps?.some((step) =>
            desktopInputs.includes(desktopStep(step).tool),
          ));
      const outcome = action
        ? {
            execution: result.isError ? "incomplete" : "delivered",
            verification: result.postcondition
              ? "checked"
              : !result.isError &&
                  (structured?.verified === true ||
                    structured?.effect === "confirmed")
                ? "confirmed"
                : "required",
            observation:
              structured?.observation?.ok === false ||
              captureError !== undefined
                ? "failed"
                : observed
                  ? "available"
                  : "not-requested",
            ...(structured?.effect ? { effect: structured.effect } : {}),
            ...(structured?.escalation
              ? { escalation: structured.escalation }
              : {}),
            next: "Check the intended postcondition with expect, verify_state or fresh observation. Observation alone does not confirm success. Never replay delivered actions to recover an observation failure.",
          }
        : undefined;
      if (outcome && structured) structured.domos = outcome;
      return {
        content: [
          ...(result.text ? [{ type: "text", text: result.text }] : []),
          ...(captureError ? [{ type: "text", text: captureError }] : []),
          ...(outcome
            ? [{ type: "text", text: JSON.stringify({ domos: outcome }) }]
            : []),
          ...(images.length && !delivered.length
            ? [
                {
                  type: "text",
                  text: "Screenshot unchanged. Use the previous image with the current capture and snapshot metadata.",
                },
              ]
            : []),
          ...delivered.map((image) => ({
            type: "image",
            mimeType: image.mimeType,
            data: image.dataBase64,
          })),
        ],
        ...(structured ? { structuredContent: structured } : {}),
        isError: Boolean(
          result.isError ||
            captureError !== undefined ||
            structured?.observation?.ok === false,
        ),
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
