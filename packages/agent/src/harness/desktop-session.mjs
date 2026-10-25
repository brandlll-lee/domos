import { createHash } from "node:crypto";
import { desktopInputs, desktopStep } from "./desktop-actions.mjs";

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
      let state = sessions.get(args.session);
      if (!state || state.owner !== owner) {
        state = { owner, scopes: new Map() };
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
      const reading = name === "get_window_state" ? args : args.observe;
      const scope =
        reading &&
        JSON.stringify([
          reading.query ?? "",
          reading.max_elements ?? 250,
          reading.max_depth ?? 25,
          reading.full_output === true,
        ]);
      const readsTree = reading && reading.include_accessibility_tree !== false;
      const baseline = (value) =>
        JSON.stringify([value.pid, value.window_id, scope]);
      if (readsTree) {
        const previous = state.scopes.get(baseline({ ...args, ...reading }));
        if (reading.full_output) delete reading.since;
        else if (
          reading.since ||
          (name === "run_steps" && reading.since === undefined)
        ) {
          if (
            previous &&
            (!reading.since ||
              reading.since === "latest" ||
              reading.since === previous)
          )
            reading.since ??= "latest";
          else if (name === "run_steps") reading.since = null;
          else delete reading.since;
        }
      }
      const steps =
        name === "run_steps"
          ? (args.steps ?? []).map(desktopStep)
          : [{ tool: name, args }];
      const mutating = steps.some((step) => desktopInputs.includes(step.tool));
      if (mutating && state.review)
        return {
          images: [],
          isError: true,
          text: "The previous action was delivered but its effect is unconfirmed. Observe that window or use verify_state before another action. Do not replay the previous action.",
        };
      const key = JSON.stringify([name, args], (key, value) =>
        ["capture_id", "snapshot_id", "since", "observe"].includes(key)
          ? undefined
          : key === "element_token"
            ? value?.split(":").at(-1)
            : value,
      );
      const action = steps.some((step) =>
        ["click", "double_click", "right_click"].includes(step.tool),
      )
        ? key
        : undefined;
      if (state.attempt?.key === key && state.attempt.count >= 3)
        return {
          ...state.attempt.result,
          isError: true,
          text: `${state.attempt.result.text ?? ""}\nThe same action was attempted three times without a successful postcondition check. Use verify_state or run_steps with expect. Do not replay uncertain actions.`,
        };
      const result = await driver.callTool(name, JSON.stringify(args), {
        signal,
      });
      if (result.errorCode === "session_ended") {
        sessions.delete(args.session);
        if (recover && observations.has(name))
          return this.call(name, args, owner, signal, false);
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
          (name === "verify_state" &&
            ["satisfied", "unsatisfied"].includes(value?.status)))
      )
        state.review = false;
      if (
        mutating &&
        !result.isError &&
        !observed &&
        (value?.verified === false ||
          ["unverifiable", "suspected_noop", "partial"].includes(
            value?.effect,
          ) ||
          /not verified/i.test(result.text ?? ""))
      )
        state.review = true;
      if (name === "get_window_state" && result.isError) state.review = true;
      if (readsTree && !result.isError && observed?.snapshot_id) {
        state.scopes.set(baseline(observed), observed.snapshot_id);
        if (state.scopes.size > 32)
          state.scopes.delete(state.scopes.keys().next().value);
      }
      const checked =
        !result.isError &&
        ((name === "verify_state" &&
          value?.status === "satisfied" &&
          value.stable === true) ||
          (name === "run_steps" &&
            value?.steps?.length === args.steps?.length &&
            value.steps.every((step) => step.ok) &&
            (args.steps.at(-1)?.expect?.length ||
              (args.steps.at(-1)?.wait_for && !steps.at(-1)?.tool))));
      if (checked) {
        state.attempt = undefined;
        state.review = false;
      } else if (mutating)
        state.attempt =
          result.isError || action
            ? {
                key,
                result,
                count: state.attempt?.key === key ? state.attempt.count + 1 : 1,
              }
            : undefined;
      if (name === "end_session" && !result.isError)
        sessions.delete(args.session);
      return checked ? { ...result, postcondition: true } : result;
    },
    images(session, owner, name, target, images) {
      const state = sessions.get(session);
      if (!state || state.owner !== owner || !images.length) return images;
      const hash = createHash("sha256").update(
        JSON.stringify([
          name,
          target?.pid,
          target?.window_id,
          target?.window_bounds,
        ]),
      );
      for (const image of images)
        hash.update(image.mimeType).update(image.dataBase64);
      const frame = hash.digest("hex");
      const same = frame === state.frame;
      state.frame = frame;
      return same ? [] : images;
    },
    clear(owner) {
      for (const [session, state] of sessions)
        if (state.owner === owner) sessions.delete(session);
    },
  };
}
