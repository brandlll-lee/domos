import type { Context } from "@earendil-works/chord/context";
import type { EntryId, EntryRecord } from "@earendil-works/pi-durable";
import { messageText } from "../messages.ts";
import { EngineMessage } from "./state.ts";
import type { EngineRuntime, StoredMessage } from "./task-types.ts";
import { engineLimits } from "./types.ts";

export async function conversationHistory(
  runtime: EngineRuntime,
  turnId: string | null,
  context: Context,
  through: EntryId | null,
  before?: EntryId,
  budget: number = engineLimits.historyCharacters,
) {
  let entries: readonly EntryRecord[] = [];
  let bounded = before !== undefined;
  await runtime.commit(async (tx, current) => {
    const maxEntryId =
      before ??
      (turnId && current.input.entryId
        ? ((current.input.entryId - 1) as EntryId)
        : undefined);
    bounded = maxEntryId !== undefined;
    entries = (
      await tx.scanEntries(
        {
          conversationId: runtime.conversationId,
          order: "descending",
          maxEntryId,
        },
        engineLimits.historyEntries,
      )
    ).items;
  }, context);
  const current = entries.findIndex(
    (entry) =>
      entry.kind === EngineMessage &&
      (entry.data as StoredMessage).id === turnId,
  );
  if (turnId && current < 0 && !bounded && entries.length)
    throw new Error("当前消息的上下文边界无法确认。");
  const previous = entries
    .slice(current + 1)
    .filter((entry) => !through || entry.id > through);
  const messages = previous
    .toReversed()
    .flatMap((entry) => {
      if (entry.kind === EngineMessage) {
        const message = entry.data as StoredMessage;
        return message.role !== "assistant" ||
          !message.content.every((part) => part.type === "thinking") ||
          message.error ||
          message.attachments?.length
          ? [
              {
                entryId: entry.id,
                role: message.role,
                text:
                  message.error ??
                  messageText(
                    message as unknown as Parameters<typeof messageText>[0],
                  ),
                status:
                  message.error || message.isError
                    ? "failed"
                    : message.stopped
                      ? "stopped"
                      : "recorded",
                ...(message.toolName ? { tool: message.toolName } : {}),
                ...(message.attachments?.length
                  ? {
                      attachments: message.attachments.map(
                        ({ id, path, name, computerId }) => ({
                          id,
                          path,
                          name,
                          computerId,
                        }),
                      ),
                    }
                  : {}),
              },
            ]
          : [];
      }
      return (entry.model ?? []).flatMap((message) =>
        message.role === "user" || message.role === "assistant"
          ? [
              {
                entryId: entry.id,
                role: message.role,
                text: messageText(message),
                status: "recorded",
              },
            ]
          : [],
      );
    })
    .filter((message) => message.text.trim() || "attachments" in message);
  let remaining = Math.max(0, Math.min(engineLimits.historyCharacters, budget));
  const selected = [];
  for (const message of messages.reverse()) {
    if (!remaining) break;
    const text = Buffer.from(message.text)
      .subarray(
        0,
        Math.max(
          0,
          Math.min(engineLimits.historyCharacters / 4, remaining - 1024),
        ),
      )
      .toString("utf8")
      .replace(/\uFFFD$/, "");
    const item = {
      ...message,
      text,
      ...(text !== message.text ? { excerpt: true } : {}),
    };
    const bytes = Buffer.byteLength(JSON.stringify(item));
    if (bytes > remaining) break;
    remaining -= bytes;
    selected.unshift(item);
  }
  if (!selected.length) {
    if (messages.length)
      throw new Error(
        "会话交接预算不足。聊天记录已保留，请压缩会话或选择更大上下文的模型。",
      );
    return "";
  }
  return JSON.stringify({
    after: through,
    from: selected[0]?.entryId,
    through: selected.at(-1)?.entryId,
    excerpt:
      selected.length < messages.length ||
      entries.length === engineLimits.historyEntries,
    messages: selected,
  });
}
