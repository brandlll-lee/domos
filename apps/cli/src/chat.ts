import { randomUUID } from "node:crypto";
import { messageText } from "@domos/agent/view";
import {
  BACKGROUND_CONTEXT,
  type Context,
} from "@earendil-works/chord/context";
import {
  type Conversation,
  type ConversationView,
  LiveDoc,
  type LiveState,
} from "@earendil-works/pi-durable";

export async function reply(
  conversation: Conversation,
  input: string,
  context: Context,
  write: (text: string) => void,
) {
  const view = await conversation.viewState(context);
  const previous = new Set(view.value.entries.map((entry) => entry.id));
  let printed = "";
  const render = (value: ConversationView) => {
    const messages = value.entries
      .filter((entry) => !previous.has(entry.id))
      .flatMap((entry) => entry.model ?? []);
    const live = value.docs[LiveDoc.definition.kind] as LiveState | undefined;
    if (live?.generation?.message) messages.push(live.generation.message);
    const text = messages
      .filter(
        (message) =>
          message.role === "assistant" &&
          message.stopReason !== "error" &&
          message.stopReason !== "aborted",
      )
      .map(messageText)
      .join("");
    if (text === printed) return;
    write(text.startsWith(printed) ? text.slice(printed.length) : `\n${text}`);
    printed = text;
  };
  view.subscribe(render);
  try {
    const submission = await conversation.submit(
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
