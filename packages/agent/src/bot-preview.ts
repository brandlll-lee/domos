import type { Context } from "@earendil-works/chord/context";
import type {
  Conversation,
  Cursor,
  EntryRecord,
} from "@earendil-works/pi-durable";
import type { MessageDelivery } from "./delivery.ts";
import { FileInput } from "./files.ts";
import { EngineMessage } from "./harness/state.ts";
import type { ChatMessage } from "./messages.ts";
import { messageText } from "./messages.ts";
import { previewText } from "./preview-text.ts";
import { RoutineInput } from "./work/routine-state.ts";

const pageSize = 32;
const previewLength = 160;
const excerpt = (text: string) =>
  Array.from(text.trim()).slice(0, previewLength).join("");

function entryPreview(entry: EntryRecord) {
  if (entry.kind === EngineMessage) {
    const message = entry.data as unknown as ChatMessage;
    if (message.pending || message.stopped || message.stopReason === "error")
      return;
    if (
      (message.delivery ||
        (message.role === "toolResult" && message.attachments?.length)) &&
      !message.isError
    )
      return {
        text: previewText(message.delivery?.text ?? ""),
        timestamp: message.timestamp,
      };
    if (message.role === "user" || message.role === "assistant") {
      const text = messageText(message);
      if (
        message.role === "user" ||
        text.trim() ||
        message.attachments?.length ||
        message.content.some((part) => part.type === "image")
      )
        return {
          text: message.role === "assistant" ? previewText(text) : text,
          timestamp: message.timestamp,
        };
    }
    return;
  }
  for (const message of [...(entry.model ?? [])].reverse()) {
    if (message.role === "user") {
      const input =
        entry.kind === FileInput || entry.kind === RoutineInput
          ? (entry.data as { text: string })
          : undefined;
      return {
        text: input?.text ?? messageText(message),
        timestamp: message.timestamp,
      };
    }
    if (
      message.role === "assistant" &&
      message.stopReason !== "error" &&
      message.stopReason !== "aborted"
    ) {
      const text = messageText(message);
      if (text.trim())
        return { text: previewText(text), timestamp: message.timestamp };
    }
    if (message.role === "toolResult" && !message.isError) {
      const details = message.details as {
        delivery?: MessageDelivery;
        attachment?: unknown;
      };
      const diagnostics = (entry.data as { diagnostics?: { code: string }[] })
        ?.diagnostics;
      if (
        (details?.delivery || details?.attachment) &&
        !diagnostics?.some((item) => item.code === "aborted")
      )
        return {
          text: previewText(details.delivery?.text ?? ""),
          timestamp: message.timestamp,
        };
    }
  }
}

export async function botPreview(
  conversation: Conversation,
  instructions: string,
  context: Context,
) {
  let cursor: Cursor | undefined;
  let latest: { lastMessageAt?: number } | undefined;
  do {
    const page = await conversation.entries({}, pageSize, cursor, context);
    for (const entry of page.items) {
      const message = entryPreview(entry);
      if (!message) continue;
      latest ??= Number.isFinite(message.timestamp)
        ? { lastMessageAt: message.timestamp }
        : {};
      const text = message.text.trim();
      if (text) return { preview: excerpt(text), ...latest };
    }
    cursor = page.next;
  } while (cursor);
  return { preview: excerpt(instructions), ...latest };
}
