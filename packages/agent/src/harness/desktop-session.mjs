import { createHash } from "node:crypto";

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
      const key = JSON.stringify([name, args]);
      const visual = [
        "click",
        "double_click",
        "right_click",
        "scroll",
      ].includes(name);
      const action = visual
        ? JSON.stringify([name, args], (key, value) =>
            key === "capture_id"
              ? undefined
              : key === "element_token"
                ? value.split(":").at(-1)
                : value,
          )
        : undefined;
      if (action && state.repeat?.key === action && state.repeat.count >= 3)
        return {
          images: [],
          isError: true,
          text: "The same action left the screen unchanged three times. Observe the target and use a different action.",
        };
      if (state.failure?.key === key && state.failure.count >= 3)
        return {
          ...state.failure.result,
          text: `${state.failure.result.text}\nThe same action failed three times. Observe the target and use a different action.`,
        };
      const result = await driver.callTool(name, JSON.stringify(args), {
        signal,
      });
      if (visual && !result.isError) state.pending = action;
      else if (!observations.has(name)) state.pending = undefined;
      if (result.errorCode === "session_ended") {
        sessions.delete(args.session);
        if (recover && observations.has(name))
          return this.call(name, args, owner, signal, false);
      }
      if (!observations.has(name)) {
        state.failure = result.isError
          ? {
              key,
              result,
              count: state.failure?.key === key ? state.failure.count + 1 : 1,
            }
          : undefined;
      }
      if (name === "end_session" && !result.isError)
        sessions.delete(args.session);
      return result;
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
      if (!same) {
        state.failure = undefined;
        state.repeat = undefined;
      } else if (state.pending) {
        state.repeat = {
          key: state.pending,
          count:
            state.repeat?.key === state.pending ? state.repeat.count + 1 : 1,
        };
      }
      state.pending = undefined;
      state.frame = frame;
      return same ? [] : images;
    },
    clear(owner) {
      for (const [session, state] of sessions)
        if (state.owner === owner) sessions.delete(session);
    },
  };
}
