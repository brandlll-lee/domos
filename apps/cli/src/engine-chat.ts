import { randomUUID } from "node:crypto";
import type { Engines } from "@domos/agent/harness";
import { messageText } from "@domos/agent/messages";
import type { ChatView } from "@domos/agent/view";
import { type Context, withAbortSignal } from "@earendil-works/chord/context";

export async function engineReply(
  engines: Engines,
  botId: number,
  input: string,
  context: Context,
  write: (text: string) => void,
) {
  const previous = new Set(
    (await engines.view(botId, context)).messages.map((message) => message.id),
  );
  let printed = "";
  const render = (view: ChatView) => {
    const text = view.messages
      .filter(
        (message) =>
          !previous.has(message.id) &&
          message.role === "assistant" &&
          !message.stopped,
      )
      .map(messageText)
      .join("");
    if (text === printed) return;
    write(text.startsWith(printed) ? text.slice(printed.length) : `\n${text}`);
    printed = text;
  };
  const controller = new AbortController();
  const signal = context.abortSignal
    ? AbortSignal.any([context.abortSignal, controller.signal])
    : controller.signal;
  const watch = (async () => {
    for await (const view of engines.watch(
      botId,
      withAbortSignal(signal, context),
    ))
      render(view);
  })();
  void watch.catch(() => {});
  try {
    const submission = await engines.submit(
      botId,
      { text: input, requestId: randomUUID() },
      context,
    );
    const result = await submission.wait(context);
    render(await engines.view(botId, context));
    return result.status === "done";
  } finally {
    controller.abort();
    await watch.catch(() => {});
  }
}
