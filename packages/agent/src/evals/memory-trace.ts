import type { Context } from "@earendil-works/chord/context";
import type { Cursor, EntryRecord } from "@earendil-works/pi-durable";
import { EngineMessage } from "../harness/state.ts";
import { type ChatMessage, messageText } from "../messages.ts";
import type { openChat } from "../open-chat.ts";

export async function readMemoryTrace(
  conversation: Awaited<ReturnType<typeof openChat>>["conversation"],
  id: string,
  context: Context,
) {
  const entries: EntryRecord[] = [];
  let cursor: Cursor | undefined;
  do {
    const page = await conversation.entries(
      { order: "ascending" },
      500,
      cursor,
      context,
    );
    entries.push(...page.items);
    cursor = page.next;
  } while (cursor);
  const messages = new Map<
    string,
    { message: ChatMessage; entryId: number; taskId: string | null }
  >();
  for (const entry of entries) {
    if (entry.kind !== EngineMessage) continue;
    const message = entry.data as unknown as ChatMessage;
    messages.set(message.id, {
      message,
      entryId: Number(entry.id),
      taskId: entry.byTaskId == null ? null : String(entry.byTaskId),
    });
  }
  const rows = [...messages.values()];
  return {
    messages: rows,
    sourceIds: entries
      .filter((entry) => entry.kind === EngineMessage)
      .map((entry) => Number(entry.id)),
    answers: rows
      .filter(
        ({ message }) =>
          message.role === "user" &&
          message.requestId?.startsWith(`eval:${id}:`),
      )
      .map(({ message }) => {
        const turn = rows.filter(
          (row) => message.turnId && row.message.turnId === message.turnId,
        );
        const replies = turn.filter(
          (row) =>
            row.message.role === "assistant" &&
            !row.message.pending &&
            row.message.content.some((part) => part.type === "text"),
        );
        return {
          prompt: messageText(message),
          requestId: message.requestId,
          turnId: message.turnId ?? null,
          taskId: turn.find((row) => row.taskId)?.taskId ?? null,
          messages: replies.map((row) => ({
            entryId: row.entryId,
            messageId: row.message.id,
            text: messageText(row.message),
          })),
          completion: "unreviewed" as const,
        };
      }),
    calls: rows.flatMap(({ message, entryId }) =>
      message.content
        .filter((part) => part.type === "toolCall")
        .map((call) => {
          const result = rows.find((row) => row.message.toolCallId === call.id);
          return {
            id: call.id,
            name: call.name,
            input: call.arguments,
            message: { entryId, messageId: message.id },
            ...(result
              ? {
                  result: {
                    entryId: result.entryId,
                    messageId: result.message.id,
                  },
                }
              : {}),
            output: result?.message.content ?? null,
            isError:
              !result ||
              result.message.isError === true ||
              result.message.toolStatus === "running",
          };
        }),
    ),
  };
}
