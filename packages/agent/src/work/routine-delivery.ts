import type { ChatView } from "../chat-view.ts";
import type { RoutineRun } from "./routine-state.ts";

export function applyRoutineDelivery(view: ChatView, runs: RoutineRun[]) {
  for (const run of runs) {
    const input = view.messages.find(
      (message) =>
        message.role === "user" &&
        (message.requestId === run.requestId ||
          message.routine?.runId === run.id),
    );
    const turnId = run.turnId ?? input?.turnId;
    if (!turnId) continue;
    const messages = view.messages.filter(
      (message) => message.turnId === turnId,
    );
    const source = {
      runId: run.id,
      title: run.title,
      scheduledAt: run.scheduledAt,
      turnId,
    };
    if (input) {
      input.hidden = true;
      input.routine = source;
    }
    if (run.delivery === "conditional") {
      for (const message of messages)
        if (
          message.id !== `routine-result:${run.id}` &&
          message.id !== `routine-status:${run.id}` &&
          !message.approval &&
          !message.takeover
        )
          message.hidden = true;
      if (view.activeTurnId === turnId) view.processing = false;
    } else {
      const result = messages.find(
        (message) =>
          message.role === "assistant" &&
          !message.approval &&
          !message.takeover &&
          message.content.some(
            (part) => part.type === "text" && part.text.trim(),
          ),
      );
      if (result) result.routine = source;
    }
  }
}
