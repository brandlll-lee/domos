import { desktopMutation, desktopStep } from "./desktop-actions.mjs";

const observations = new Set([
  "get_window_state",
  "get_desktop_state",
  "list_apps",
  "list_windows",
  "get_accessibility_tree",
  "verify_state",
  "zoom",
]);

export function openDesktopSession(driver) {
  const sessions = new Map();
  return {
    async call(name, args, owner, signal, recover = true) {
      signal?.throwIfAborted();
      let state = sessions.get(args.session);
      if (!state || state.owner !== owner) {
        state = { owner };
        sessions.delete(args.session);
        const started = await driver.callTool(
          "start_session",
          JSON.stringify({ session: args.session }),
          { signal },
        );
        if (started.isError) {
          sessions.delete(args.session);
          return started;
        }
        const cursor = await driver.callTool(
          "set_agent_cursor_enabled",
          JSON.stringify({ session: args.session, enabled: false }),
          { signal },
        );
        if (cursor.isError) {
          sessions.delete(args.session);
          return cursor;
        }
        sessions.set(args.session, state);
      }
      const steps =
        name === "run_steps"
          ? (args.steps ?? []).map(desktopStep)
          : [{ tool: name, args }];
      const mutating = desktopMutation(name, args);
      if (mutating && state.review)
        return {
          images: [],
          isError: true,
          text: "The previous action was delivered but its effect is unconfirmed. Observe that window or use verify_state before another action. Do not replay the previous action.",
        };
      const savedTarget =
        mutating &&
        !state.observed &&
        /"(?:element_token|capture_id|snapshot_id)"\s*:/.test(
          JSON.stringify(args),
        );
      if (mutating) state.review = true;
      const result = savedTarget
        ? { isError: true, errorCode: "session_ended" }
        : await driver.callTool(name, JSON.stringify(args), { signal });
      if (result.errorCode === "session_ended") {
        sessions.delete(args.session);
        if (recover && observations.has(name))
          return this.call(name, args, owner, signal, false);
        if (recover && mutating) {
          const target = args.target?.kind === "window" ? args.target : args;
          const window =
            target.pid !== undefined && target.window_id !== undefined;
          const fresh = await this.call(
            window ? "get_window_state" : "get_desktop_state",
            {
              session: args.session,
              ...(window
                ? { pid: target.pid, window_id: target.window_id }
                : {}),
              max_image_dimension: 1200,
            },
            owner,
            signal,
            false,
          );
          return {
            ...result,
            images: [...(result.images ?? []), ...(fresh.images ?? [])],
            isError: true,
            text: `${savedTarget ? "The requested action was not executed because its saved desktop target needs a fresh observation." : "The desktop session ended. Preserve the original action result; no action was replayed."}\nOriginal result: ${result.text ?? result.structuredJson ?? result.errorCode}\nObservation${fresh.isError ? " failed" : ""}: ${fresh.text ?? fresh.structuredJson ?? "unavailable"}`,
          };
        }
      }
      const value = result.structuredJson
        ? JSON.parse(result.structuredJson)
        : undefined;
      const observed =
        name === "get_window_state"
          ? value
          : value?.observation?.ok
            ? value.observation.state
            : undefined;
      if (
        !result.isError &&
        (observed ||
          name === "get_desktop_state" ||
          name === "get_accessibility_tree" ||
          (name === "verify_state" &&
            ["satisfied", "unsatisfied"].includes(value?.status)))
      ) {
        state.review = false;
        state.observed = true;
      }
      const checked =
        !result.isError &&
        value?.observation?.ok !== false &&
        ((name === "verify_state" &&
          value?.status === "satisfied" &&
          value.stable === true) ||
          (name === "run_steps" &&
            value?.steps?.length === args.steps?.length &&
            value.steps.every((step) => step.ok) &&
            (args.steps.at(-1)?.expect?.length ||
              (args.steps.at(-1)?.wait_for && !steps.at(-1)?.tool))));
      if (mutating)
        state.review =
          name === "run_script" ||
          result.isError ||
          value?.observation?.ok === false ||
          (!checked &&
            !observed &&
            value?.verified !== true &&
            value?.effect !== "confirmed");
      else if (name === "get_window_state" && result.isError)
        state.review = true;
      if (checked) state.review = false;
      if (name === "end_session" && !result.isError)
        sessions.delete(args.session);
      return checked ? { ...result, postcondition: true } : result;
    },
    clear(owner) {
      for (const [session, state] of sessions)
        if (state.owner === owner) sessions.delete(session);
    },
  };
}
