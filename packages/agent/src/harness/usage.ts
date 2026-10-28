import type { Context } from "@earendil-works/chord/context";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  ConversationId,
  Cursor,
  Harness,
} from "@earendil-works/pi-durable";
import type { EngineId, EngineUsage } from "./types.ts";

export const EngineUsageEntry = "domos.engine-usage";
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

export class UsageReader {
  private readonly harness: Harness;
  private cached?: { key: string; result: Promise<UsageRecord[]> };

  constructor(harness: Harness) {
    this.harness = harness;
    const invalidate = () => {
      this.cached = undefined;
    };
    const unsubscribe = harness.subscribeCommits(({ changes }) => {
      if (
        changes.some(
          (change) =>
            change.type === "conversation" ||
            (change.type === "entry" &&
              (change.value.kind === EngineUsageEntry ||
                change.value.kind === "pi.assistant")),
        )
      )
        invalidate();
    });
    harness.subscribeClose(() => {
      unsubscribe();
      invalidate();
    });
  }

  read(botIds: number[], filter: UsageFilter, context: Context) {
    const key = JSON.stringify([
      botIds,
      filter.botId,
      filter.harness,
      filter.provider,
      filter.model,
      filter.from,
      filter.to,
    ]);
    if (this.cached?.key === key) return this.cached.result;
    const result = readUsage(this.harness, botIds, filter, context).catch(
      (cause) => {
        if (this.cached?.result === result) this.cached = undefined;
        throw cause;
      },
    );
    this.cached = { key, result };
    return result;
  }
}

async function readUsage(
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
        if (entry.kind !== EngineUsageEntry && entry.kind !== "pi.assistant")
          continue;
        const message = entry.model?.find(
          (item): item is AssistantMessage => item.role === "assistant",
        );
        const row: UsageRecord =
          entry.kind === EngineUsageEntry
            ? (entry.data as UsageRecord)
            : {
                id: String(entry.id),
                source: "pi-durable",
                provider: message?.provider ?? null,
                model: message?.model ?? null,
                input: message?.usage.input ?? null,
                output: message?.usage.output ?? null,
                cacheRead: message?.usage.cacheRead ?? null,
                cacheWrite: message?.usage.cacheWrite ?? null,
                costUsd: message?.usage.cost?.total ?? null,
                botId: id,
                harness: "pi",
                taskId: String(entry.byTaskId ?? entry.id),
                sessionId: null,
                timestamp: message?.timestamp ?? 0,
              };
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
