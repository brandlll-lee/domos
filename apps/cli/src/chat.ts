import { randomUUID } from "node:crypto";
import { messageText } from "@domos/agent/messages";
import type { Runtime } from "@domos/agent/runtime";
import { type ChatView, chatView } from "@domos/agent/view";
import {
  BACKGROUND_CONTEXT,
  type Context,
  withAbortSignal,
} from "@earendil-works/chord/context";
import type { Conversation } from "@earendil-works/pi-durable";

export async function reply(
  conversation: Conversation,
  input: string,
  context: Context,
  write: (text: string) => void,
  engines?: Runtime,
) {
  const view = await conversation.viewState(context);
  const previous = new Set(
    (engines
      ? await engines.view(conversation.id, context)
      : chatView(view.value)
    ).messages.map((message) => message.id),
  );
  let printed = "";
  const render = (state: ChatView) => {
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
  const watch = new AbortController();
  const watching = engines
    ? (async () => {
        for await (const value of engines.watch(
          conversation.id,
          withAbortSignal(watch.signal, context),
        ))
          render(value);
      })()
    : undefined;
  void watching?.catch(() => {});
  if (!engines) view.subscribe((value) => render(chatView(value)));
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
    render(
      engines
        ? await engines.view(conversation.id, context)
        : chatView(view.value),
    );
    return result.status === "done";
  } finally {
    watch.abort();
    await watching?.catch(() => {});
    view.dispose();
  }
}
