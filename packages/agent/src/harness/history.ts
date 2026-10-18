import type { Context } from "@earendil-works/chord/context";
import type { EntryRecord } from "@earendil-works/pi-durable";
import { messageText } from "../messages.ts";
import { EngineMessage } from "./state.ts";
import type { EngineRuntime, StoredMessage } from "./task-types.ts";
import { engineLimits } from "./types.ts";

export async function conversationHistory(
  runtime: EngineRuntime,
  turnId: string | null,
  context: Context,
) {
  let entries: readonly EntryRecord[] = [];
  await runtime.commit(async (tx) => {
    entries = (
      await tx.scanEntries(
        { conversationId: runtime.conversationId, order: "descending" },
        engineLimits.historyEntries,
      )
    ).items;
  }, context);
  const current = entries.findIndex(
    (entry) =>
      entry.kind === EngineMessage &&
      (entry.data as StoredMessage).id === turnId,
  );
  const messages = entries
    .slice(current + 1)
    .reverse()
    .flatMap((entry) => {
      if (entry.kind === EngineMessage) {
        const message = entry.data as StoredMessage;
        return message.role === "user" || message.role === "assistant"
          ? [
              {
                role: message.role,
                text: messageText(
                  message as unknown as Parameters<typeof messageText>[0],
                ),
              },
            ]
          : [];
      }
      return (entry.model ?? []).flatMap((message) =>
        message.role === "user" || message.role === "assistant"
          ? [{ role: message.role, text: messageText(message) }]
          : [],
      );
    })
    .filter((message) => message.text.trim());
  let remaining = engineLimits.historyCharacters;
  const selected = [];
  for (const message of messages.reverse()) {
    if (!remaining) break;
    const text = message.text.slice(-remaining);
    remaining -= text.length;
    selected.unshift({ role: message.role, text });
  }
  return JSON.stringify(selected);
}
