import type { ConversationId, EntryId, Tx } from "@earendil-works/pi-durable";
import { historyEvidence } from "../harness/history.ts";
import { EngineMessage, EngineToolResult } from "../harness/state.ts";
import type { ChatMessage } from "../messages.ts";
import { messageText } from "../messages.ts";
import { WorkError } from "./state.ts";

export type MemoryOrigin = "user" | "tool" | "inference" | "manual";
export type MemoryEvidence = {
  conversationId: number;
  entryId: number;
  quote: string;
};

export async function verifyMemoryEvidence(
  tx: Tx,
  conversationId: number,
  evidence: readonly MemoryEvidence[],
  origin: MemoryOrigin,
) {
  if (evidence.length > 8)
    throw new WorkError("BAD_REQUEST", "记忆最多引用 8 条出处。");
  if ((origin === "user" || origin === "tool") && !evidence.length)
    throw new WorkError("BAD_REQUEST", "用户事实和工具观察必须提供原始出处。");
  for (const ref of evidence) {
    let entry: Awaited<ReturnType<typeof historyEvidence>>;
    try {
      entry = await historyEvidence(
        tx,
        conversationId as ConversationId,
        ref.entryId as EntryId,
      );
    } catch {
      throw new WorkError("NOT_FOUND", "记忆出处不存在或无权读取。");
    }
    if (entry.conversationId !== ref.conversationId)
      throw new WorkError("BAD_REQUEST", "记忆出处会话不匹配。");
    const messages =
      entry.kind === EngineMessage
        ? [entry.data as unknown as ChatMessage]
        : (entry.model ?? []);
    const matching = messages.filter((message) =>
      origin === "user"
        ? message.role === "user"
        : origin === "tool"
          ? message.role === "toolResult"
          : true,
    );
    const text =
      origin !== "user" && entry.kind === EngineToolResult
        ? JSON.stringify(entry.data)
        : matching.map(messageText).join("\n");
    if (
      !ref.quote.trim() ||
      ref.quote.length > 2000 ||
      !text.includes(ref.quote)
    )
      throw new WorkError("BAD_REQUEST", "出处摘录与原始记录不匹配。");
  }
}
