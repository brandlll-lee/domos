import type { Context } from "@earendil-works/chord/context";
import {
  type ConversationId,
  type Cursor,
  defineDoc,
  type Harness,
  type Tx,
} from "@earendil-works/pi-durable";
import type { EngineRuntime } from "./task-types.ts";
import type { EngineId, EngineUsage } from "./types.ts";

export const EngineUsageEntry = "domos.engine-usage";
export const UsageTaskDoc = defineDoc<{ items: Record<string, EngineUsage> }>({
  kind: "domos.engine-usage",
  version: 1,
  scope: "task",
  initial: () => ({ items: {} }),
});
export type UsageRecord = EngineUsage & {
  botId: number;
  harness: EngineId;
  taskId: string;
  sessionId: string | null;
  timestamp: number;
};
export type UsageFilter = {
  botId?: number;
  harness?: EngineId;
  provider?: string;
  model?: string;
  from?: number;
  to?: number;
};

export async function finishUsage(
  tx: Tx,
  runtime: EngineRuntime,
  harness: EngineId,
  sessionId: string | null,
) {
  const doc = await tx.doc(UsageTaskDoc, runtime.taskId);
  for (const usage of Object.values(doc.items)) {
    await tx.appendEntry(runtime.conversationId, {
      kind: EngineUsageEntry,
      data: {
        ...usage,
        botId: runtime.conversationId,
        harness,
        taskId: String(runtime.taskId),
        sessionId,
        timestamp: Date.now(),
      },
    });
  }
  doc.items = {};
}

export async function readUsage(
  harness: Harness,
  botIds: number[],
  filter: UsageFilter,
  context: Context,
): Promise<UsageRecord[]> {
  const rows: UsageRecord[] = [];
  for (const id of botIds) {
    if (filter.botId !== undefined && id !== filter.botId) continue;
    const conversation = await harness.conversation(
      id as ConversationId,
      context,
    );
    if (!conversation) continue;
    let cursor: Cursor | undefined;
    do {
      const page = await conversation.entries(
        { order: "descending" },
        500,
        cursor,
        context,
      );
      for (const entry of page.items) {
        if (entry.kind !== EngineUsageEntry) continue;
        const row = entry.data as UsageRecord;
        if (filter.harness && row.harness !== filter.harness) continue;
        if (filter.provider && row.provider !== filter.provider) continue;
        if (filter.model && row.model !== filter.model) continue;
        if (filter.from !== undefined && row.timestamp < filter.from) continue;
        if (filter.to !== undefined && row.timestamp > filter.to) continue;
        rows.push(row);
      }
      cursor = page.next;
    } while (cursor);
  }
  return rows.sort(
    (a, b) =>
      b.timestamp - a.timestamp ||
      a.taskId.localeCompare(b.taskId) ||
      a.id.localeCompare(b.id),
  );
}
