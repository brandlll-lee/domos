import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { setImmediate } from "node:timers/promises";
import type { Context } from "@earendil-works/chord/context";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  ConversationId,
  EntryId,
  Harness,
} from "@earendil-works/pi-durable";
import { defineDoc, type Tx } from "@earendil-works/pi-durable";
import type { EngineRuntime } from "./task-types.ts";
import type { EngineId, EngineUsage } from "./types.ts";
import { priceUsage } from "./usage-cost.ts";

export const UsageTaskDoc = defineDoc<{ items: Record<string, EngineUsage> }>({
  kind: "domos.engine-usage",
  version: 1,
  checkpointWhen: () => false,
  scope: "task",
  initial: () => ({ items: {} }),
});

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
        ...priceUsage(usage, harness),
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
  query?: string;
  searchBots?: number[];
  page?: number;
};

export type UsageMetric = "cost" | "tasks" | "input" | "output";
export type UsageDimension = "model" | "provider" | "harness" | "bot";
export type UsageTotals = {
  records: number;
  tasks: number;
  unpriced: number;
  snapshots: number;
  estimated: number;
  cost: number | null;
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
};
const totalsSQL = `COUNT(*) records, COUNT(DISTINCT taskId) tasks,
  COALESCE(SUM(cost IS NULL),0) unpriced, COALESCE(SUM(scope='session'),0) snapshots,
  COALESCE(SUM(basis='estimated'),0) estimated,
  SUM(cost) cost, SUM(input) input, SUM(output) output, SUM(cacheRead) cacheRead, SUM(cacheWrite) cacheWrite`;

export class UsageReader {
  private readonly database: DatabaseSync;
  private pending?: Promise<void>;
  private revision = 0;
  private indexed = -1;
  private scope = "";
  private closed = false;
  private readonly harness: Harness;
  constructor(harness: Harness, path = ":memory:") {
    this.harness = harness;
    this.database = new DatabaseSync(path);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS domos_usage_index (
        botId INTEGER NOT NULL, entry INTEGER NOT NULL, taskId TEXT NOT NULL,
        timestamp INTEGER NOT NULL, harness TEXT NOT NULL, provider TEXT, model TEXT,
        input REAL, output REAL, cacheRead REAL, cacheWrite REAL, cost REAL, scope TEXT,
        basis TEXT, search TEXT NOT NULL, record TEXT NOT NULL, PRIMARY KEY(botId,entry)
      );
      CREATE INDEX IF NOT EXISTS domos_usage_date ON domos_usage_index(timestamp DESC,botId,entry);
      CREATE INDEX IF NOT EXISTS domos_usage_bot_date ON domos_usage_index(botId,timestamp DESC,entry);
      CREATE TABLE IF NOT EXISTS domos_usage_progress (botId INTEGER PRIMARY KEY, entry INTEGER NOT NULL);
    `);
    const unsubscribe = harness.subscribeCommits(({ changes }) => {
      if (
        changes.some(
          (change) => change.type === "conversation" || change.type === "entry",
        )
      )
        this.revision++;
    });
    harness.subscribeClose(() => {
      this.closed = true;
      unsubscribe();
      this.database.close();
    });
  }
  private async sync(botIds: number[], context: Context): Promise<void> {
    const scope = [...botIds].sort((a, b) => a - b).join(",");
    if (this.indexed === this.revision && this.scope === scope) return;
    if (this.pending) {
      await this.pending;
      return this.sync(botIds, context);
    }
    const revision = this.revision;
    this.pending = this.index(botIds, context).then(() => {
      this.indexed = revision;
      this.scope = scope;
    });
    try {
      await this.pending;
    } finally {
      this.pending = undefined;
    }
  }
  private async index(botIds: number[], context: Context) {
    const db = this.database;
    const put = db.prepare(
      `INSERT INTO domos_usage_index VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(botId,entry) DO NOTHING`,
    );
    for (const botId of botIds) {
      const conversation = await this.harness.conversation(
        botId as ConversationId,
        context,
      );
      if (!conversation) continue;
      let through = Number(
        db
          .prepare("SELECT entry FROM domos_usage_progress WHERE botId=?")
          .get(botId)?.entry ?? 0,
      );
      for (;;) {
        const page = await conversation.entries(
          { order: "ascending", minEntryId: (through + 1) as EntryId },
          200,
          undefined,
          context,
        );
        if (this.closed) throw new Error("用量服务已关闭。");
        if (!page.items.length) break;
        db.exec("BEGIN");
        try {
          for (const entry of page.items) {
            through = Math.max(through, Number(entry.id));
            if (
              entry.kind !== EngineUsageEntry &&
              entry.kind !== "pi.assistant"
            )
              continue;
            const message = entry.model?.find(
              (item): item is AssistantMessage => item.role === "assistant",
            );
            const original: UsageRecord =
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
                    botId,
                    harness: "pi",
                    taskId: String(entry.byTaskId ?? entry.id),
                    sessionId: null,
                    timestamp: message?.timestamp ?? 0,
                  };
            const row =
              original.costScope === "session"
                ? original
                : priceUsage(original, original.harness);
            put.run(
              botId,
              Number(entry.id),
              row.taskId,
              row.timestamp,
              row.harness,
              row.provider,
              row.model,
              row.input,
              row.output,
              row.cacheRead,
              row.cacheWrite,
              row.costScope === "session" ? null : row.costUsd,
              row.costScope ?? null,
              row.costBasis ?? null,
              [
                row.harness,
                row.provider,
                row.model,
                row.source,
                row.taskId,
                `Bot ${botId}`,
              ]
                .join("\n")
                .toLocaleLowerCase(),
              JSON.stringify(row),
            );
          }
          db.prepare(
            "INSERT INTO domos_usage_progress VALUES (?,?) ON CONFLICT(botId) DO UPDATE SET entry=excluded.entry",
          ).run(botId, through);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        await setImmediate();
      }
    }
  }
  private where(botIds: number[], filter: UsageFilter) {
    const clauses = [`botId IN (${botIds.map(() => "?").join(",") || "NULL"})`];
    const values: SQLInputValue[] = [...botIds];
    for (const key of ["botId", "harness", "provider", "model"] as const) {
      if (filter[key] !== undefined) {
        clauses.push(`${key}=?`);
        values.push(filter[key]);
      }
    }
    if (filter.from !== undefined) {
      clauses.push("timestamp>=?");
      values.push(filter.from);
    }
    if (filter.to !== undefined) {
      clauses.push("timestamp<=?");
      values.push(filter.to);
    }
    if (filter.query?.trim()) {
      clauses.push(
        `(instr(search,?)>0 OR botId IN (${filter.searchBots?.map(() => "?").join(",") || "NULL"}))`,
      );
      values.push(
        filter.query.trim().toLocaleLowerCase(),
        ...(filter.searchBots ?? []),
      );
    }
    return { sql: clauses.join(" AND "), values };
  }
  async read(botIds: number[], filter: UsageFilter, context: Context) {
    await this.sync(botIds, context);
    const { sql, values } = this.where(botIds, filter);
    const total = Number(
      this.database
        .prepare(`SELECT COUNT(*) total FROM domos_usage_index WHERE ${sql}`)
        .get(...values)?.total ?? 0,
    );
    const page = Math.min(
      Math.max(1, filter.page ?? 1),
      Math.max(1, Math.ceil(total / 50)),
    );
    const items = this.database
      .prepare(
        `SELECT record FROM domos_usage_index WHERE ${sql} ORDER BY timestamp DESC,botId,entry DESC LIMIT 50 OFFSET ?`,
      )
      .all(...values, (page - 1) * 50)
      .map((row) => JSON.parse(String(row.record)) as UsageRecord);
    return { items, total, page, pageSize: 50 };
  }
  async summary(
    botIds: number[],
    filter: UsageFilter,
    dimension: UsageDimension,
    metric: UsageMetric,
    limit: number,
    context: Context,
  ) {
    await this.sync(botIds, context);
    const db = this.database;
    const { sql, values } = this.where(botIds, filter);
    const totals = db
      .prepare(`SELECT ${totalsSQL} FROM domos_usage_index WHERE ${sql}`)
      .get(...values) as UsageTotals;
    const valueSQL =
      metric === "tasks" ? "COUNT(DISTINCT taskId)" : `SUM(${metric})`;
    const column = dimension === "bot" ? "CAST(botId AS TEXT)" : dimension;
    const ranked = db
      .prepare(
        `SELECT COALESCE(${column},'未提供') key, ${valueSQL} value FROM domos_usage_index WHERE ${sql} GROUP BY key ORDER BY value DESC,key`,
      )
      .all(...values) as { key: string; value: number | null }[];
    const top = ranked.slice(0, limit);
    const keys = top.map((row) => row.key);
    const groupSQL = `CASE WHEN COALESCE(${column},'未提供') IN (${keys.map(() => "?").join(",") || "NULL"}) THEN COALESCE(${column},'未提供') ELSE 'other' END`;
    const daily = db
      .prepare(
        `SELECT strftime('%Y-%m-%d',timestamp/1000,'unixepoch') day, ${groupSQL} key, ${valueSQL} value FROM domos_usage_index WHERE ${sql} GROUP BY day,key ORDER BY day,key`,
      )
      .all(...keys, ...values) as {
      day: string;
      key: string;
      value: number | null;
    }[];
    if (ranked.length > limit) {
      const others = db
        .prepare(
          `SELECT ${valueSQL} value FROM domos_usage_index WHERE ${sql} AND COALESCE(${column},'未提供') NOT IN (${keys.map(() => "?").join(",") || "NULL"})`,
        )
        .get(...values, ...keys);
      top.push({ key: "other", value: others?.value as number | null });
    }
    const days = db
      .prepare(
        `SELECT strftime('%Y-%m-%d',timestamp/1000,'unixepoch') day, SUM(cost) cost FROM domos_usage_index WHERE ${sql} GROUP BY day ORDER BY day`,
      )
      .all(...values) as { day: string; cost: number | null }[];
    const options = db
      .prepare(
        `SELECT DISTINCT provider,model FROM domos_usage_index WHERE botId IN (${botIds.map(() => "?").join(",") || "NULL"}) AND timestamp>=? AND timestamp<=?`,
      )
      .all(
        ...botIds,
        filter.from ?? 0,
        filter.to ?? Number.MAX_SAFE_INTEGER,
      ) as { provider: string | null; model: string | null }[];
    return { totals, groups: top, daily, days, options };
  }
}
