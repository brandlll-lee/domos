import { randomUUID } from "node:crypto";
import { messageText } from "@domos/agent/messages";
import type { Runtime } from "@domos/agent/runtime";
import { chatView } from "@domos/agent/view";
import {
  BACKGROUND_CONTEXT,
  type Context,
} from "@earendil-works/chord/context";
import type {
  Conversation,
  ConversationView,
} from "@earendil-works/pi-durable";

export async function reply(
  conversation: Conversation,
  input: string,
  context: Context,
  write: (text: string) => void,
  engines?: Runtime,
) {
  const view = await conversation.viewState(context);
  const previous = new Set(
    chatView(view.value).messages.map((message) => message.id),
  );
  let printed = "";
  const render = (value: ConversationView) => {
    const state = chatView(value);
    const messages = [
      ...state.messages,
      ...(state.draft ? [state.draft] : []),
    ].filter((message) => !previous.has(message.id));
    const text = messages
      .filter((message) => message.role === "assistant" && !message.stopped)
      .map(messageText)
      .join("");
    if (text === printed) return;
    write(text.startsWith(printed) ? text.slice(printed.length) : `\n${text}`);
    printed = text;
  };
  view.subscribe(render);
  try {
    const submission = engines
      ? await engines.submit(
          conversation.id,
          { text: input, requestId: randomUUID() },
          BACKGROUND_CONTEXT,
        )
      : await conversation.submit(
          { type: "input", content: input, requestId: randomUUID() },
          BACKGROUND_CONTEXT,
        );
    const result = await submission.wait(context);
    render(view.value);
    return result.status === "done";
  } finally {
    view.dispose();
  }
}
