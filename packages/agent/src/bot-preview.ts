import type { Context } from "@earendil-works/chord/context";
import type {
  Conversation,
  Cursor,
  EntryRecord,
} from "@earendil-works/pi-durable";
import type { MessageDelivery } from "./delivery.ts";
import { FileInput } from "./files.ts";
import { messageText } from "./messages.ts";
import { RoutineInput } from "./work/routine-state.ts";

const pageSize = 32;
const previewLength = 160;
const excerpt = (text: string) =>
  Array.from(text.trim()).slice(0, previewLength).join("");

function entryText(entry: EntryRecord) {
  for (const message of [...(entry.model ?? [])].reverse()) {
    if (message.role === "user") {
      const input =
        entry.kind === FileInput || entry.kind === RoutineInput
          ? (entry.data as { text: string })
          : undefined;
      return input?.text ?? messageText(message);
    }
    if (
      message.role === "assistant" &&
      (message.stopReason === "stop" || message.stopReason === "length") &&
      !message.content.some((part) => part.type === "toolCall")
    ) {
      const text = messageText(message);
      if (text.trim()) return text;
    }
    if (message.role === "toolResult" && !message.isError) {
      const delivery = (message.details as { delivery?: MessageDelivery })
        ?.delivery;
      const diagnostics = (entry.data as { diagnostics?: { code: string }[] })
        ?.diagnostics;
      if (delivery && !diagnostics?.some((item) => item.code === "aborted"))
        return delivery.text;
    }
  }
  return "";
}

export async function botPreview(
  conversation: Conversation,
  instructions: string,
  context: Context,
) {
  let cursor: Cursor | undefined;
  do {
    const page = await conversation.entries({}, pageSize, cursor, context);
    for (const entry of page.items) {
      const text = entryText(entry).trim();
      if (text) return excerpt(text);
    }
    cursor = page.next;
  } while (cursor);
  return excerpt(instructions);
}
