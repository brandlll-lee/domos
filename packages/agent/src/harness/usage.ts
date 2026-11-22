import { createHash } from "node:crypto";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { setImmediate } from "node:timers/promises";
import { copyJson, type JsonRepresentation } from "@earendil-works/chord";
import type { Context } from "@earendil-works/chord/context";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  ConversationId,
  EntryId,
  Harness,
  TaskId,
} from "@earendil-works/pi-durable";
import { defineDoc, type Tx } from "@earendil-works/pi-durable";
import { BotSession, BotSessions } from "../conversations.ts";
import { EngineDoc } from "./state.ts";
import type { EngineRuntime, EngineTaskInput } from "./task-types.ts";
import type { EngineId, EngineTokens, EngineUsage } from "./types.ts";
import { priceUsage } from "./usage-cost.ts";
import { tokenDelta, tokenFields, usageTokens } from "./usage-tokens.ts";

export const UsageTaskDoc = defineDoc<{
  items: Record<string, EngineUsage>;
  finished?: boolean;
}>({
  kind: "domos.engine-usage",
  version: 1,
  checkpointWhen: () => false,
  scope: "task",
  initial: () => ({ items: {} }),
});

const UsageLedger = defineDoc<{
  receipts: Record<string, true>;
  counters: Record<string, { tokens?: EngineTokens; cost?: number }>;
}>({
  kind: "domos.usage-ledger",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  checkpointWhen: () => false,
  initial: () => ({ receipts: {}, counters: {} }),
});

export const EngineUsageTaskEntry = "domos.usage-task";

export async function recordUsage(tx: Tx, taskId: TaskId, usage: EngineUsage) {
  const doc = await tx.doc(UsageTaskDoc, taskId);
  if (doc.finished) return;
  doc.items[usage.counterId ?? usage.id] = copyJson(usage, {
    omitUndefinedProperties: true,
  }) as JsonRepresentation<EngineUsage>;
}

export async function settleUsage(runtime: EngineRuntime, context: Context) {
  let status: "missing" | "recorded" | "failed" = "missing";
  try {
    await runtime.commit(async (tx, task) => {
      const usage = await tx.doc(UsageTaskDoc, runtime.taskId);
      status = Object.keys(usage.items).length ? "recorded" : "missing";
      const engine = await tx.doc(EngineDoc, runtime.conversationId);
      await finishUsage(
        tx,
        runtime,
        engine.config.provider,
        task.input.memoryReview ? null : engine.sessionId,
        task.input,
      );
    }, context);
  } catch (error) {
    status = "failed";
    console.warn("Harness usage settlement failed", {
      taskId: String(runtime.taskId),
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return status;
}

export async function finishUsage(
  tx: Tx,
  runtime: EngineRuntime,
  harness: EngineId,
  sessionId: string | null,
  input: EngineTaskInput,
) {
  const doc = await tx.doc(UsageTaskDoc, runtime.taskId);
  if (doc.finished) return;
  const engine = await tx.doc(EngineDoc, runtime.conversationId);
  const owner = await tx.doc(BotSession, runtime.conversationId);
  const ledger = await tx.doc(UsageLedger, runtime.conversationId);
  const purpose = input.operation
    ? "compact"
    : input.memoryReview
      ? "memory"
      : input?.source === "routine"
        ? "routine"
        : owner.purpose;
  const botId = owner.botId ?? runtime.conversationId;
  const run = engine.run?.turnId === input.turnId ? engine.run : undefined;
  const timestamp = run?.startedAt ?? Date.now();
  if (!input.memoryReview || Object.keys(doc.items).length)
    await tx.appendEntry(runtime.conversationId, {
      kind: EngineUsageTaskEntry,
      data: {
        botId,
        taskId: String(runtime.taskId),
        timestamp,
        harness,
        model: run?.model ?? engine.config.model,
        purpose,
      },
    });
  for (const usage of Object.values(doc.items)) {
    const scope = [
      usage.computerId ?? engine.computerId,
      usage.accountId,
      harness,
      usage.nativeSessionId ?? sessionId,
    ];
    const key = (value: string) =>
      createHash("sha256")
        .update(JSON.stringify([...scope, value]))
        .digest("hex");
    const receipt = key(
      `${usage.source}:${usage.id}:${usage.counterId || usage.costCounter ? runtime.taskId : ""}`,
    );
    if (ledger.receipts[receipt]) continue;
    let row = usage;
    if (row.tokensCumulative && row.counterId) {
      const identity = key(row.counterId);
      ledger.counters[identity] ??= {};
      const counter = ledger.counters[identity];
      const previous = counter.tokens ?? row.tokensBaseline;
      const reset = tokenFields.some(
        (key) =>
          row.tokensCumulative?.[key] != null &&
          previous?.[key] != null &&
          Number(row.tokensCumulative[key]) < Number(previous[key]),
      );
      row = {
        ...row,
        ...tokenDelta(row.tokensCumulative, previous),
        tokenBasis: "uncached",
        pricingReason: !previous
          ? "累计 token 基线未提供。"
          : reset
            ? "原生 token 计数器重置，当前增量未知。"
            : row.pricingReason,
      };
      counter.tokens = row.tokensCumulative;
    }
    row = usageTokens(row, harness);
    if (row.costCumulative !== undefined && row.costCounter) {
      const identity = key(`cost:${row.costCounter}`);
      ledger.counters[identity] ??= {};
      const counter = ledger.counters[identity];
      const previous =
        counter.cost ?? row.costBaseline ?? (row.costInitial ? 0 : undefined);
      const current = row.costCumulative;
      if (!Number.isFinite(current) || current < 0)
        throw new Error("原生累计成本无效。");
      row = {
        ...row,
        costUsd:
          previous === undefined || current < previous
            ? null
            : current - previous,
        pricingReason:
          previous === undefined
            ? "累计金额缺少初始基线。"
            : current < previous
              ? "原生金额计数器重置，当前增量未知。"
              : row.pricingReason,
      };
      counter.cost = current;
    }
    ledger.receipts[receipt] = true;
    await tx.appendEntry(runtime.conversationId, {
      kind: EngineUsageEntry,
      data: {
        ...priceUsage(row, harness, row.observedAt ?? timestamp),
        botId,
        harness,
        taskId: String(runtime.taskId),
        sessionId: row.nativeSessionId ?? sessionId,
        timestamp: row.observedAt ?? timestamp,
        purpose,
      },
    });
  }
  doc.items = {};
  doc.finished = true;
}

export const EngineUsageEntry = "domos.engine-usage";
export type UsageRecord = EngineUsage & {
  botId: number;
  harness: EngineId;
  taskId: string;
  sessionId: string | null;
  timestamp: number;
  purpose?: string;
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

export type UsageMetric = "cost" | "tokens" | "tasks" | "input" | "output";
export type UsageDimension =
  | "model"
  | "provider"
  | "harness"
  | "bot"
  | "day"
  | "purpose"
  | "skill";
export type UsageTotals = {
  records: number;
  tasks: number;
  unpriced: number;
  snapshots: number;
  estimated: number;
  incomplete: number;
  historical: number;
  tokens: number | null;
  cost: number | null;
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
};
const totalsSQL = `COUNT(*) records, COUNT(DISTINCT taskId) tasks,
  COALESCE(SUM(cost IS NULL),0) unpriced, COALESCE(SUM(scope='session'),0) snapshots,
  COALESCE(SUM(basis='estimated'),0) estimated,
  COALESCE(SUM(input IS NULL OR output IS NULL OR cacheRead IS NULL OR cacheWrite IS NULL),0) incomplete,
  COALESCE(SUM(historical),0) historical, SUM(input+cacheRead+cacheWrite+output) tokens,
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
    this.database.exec(
      "CREATE TABLE IF NOT EXISTS domos_usage_schema (version INTEGER NOT NULL)",
    );
    if (
      this.database.prepare("SELECT version FROM domos_usage_schema").get()
        ?.version !== 2 ||
      !this.database
        .prepare("SELECT 1 FROM sqlite_master WHERE name='domos_usage_index'")
        .get()
    ) {
      this.database.exec(`BEGIN;
        DROP TABLE IF EXISTS domos_usage_index;
        DROP TABLE IF EXISTS domos_usage_progress;
        DROP TABLE IF EXISTS domos_usage_tasks;
        DROP TABLE IF EXISTS domos_usage_skills;
        DROP TABLE IF EXISTS domos_usage_counters;
        DELETE FROM domos_usage_schema;
        INSERT INTO domos_usage_schema VALUES (2);
        COMMIT;`);
    }
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS domos_usage_index (
        botId INTEGER NOT NULL, entry INTEGER NOT NULL, taskId TEXT NOT NULL,
        timestamp INTEGER NOT NULL, harness TEXT NOT NULL, provider TEXT, model TEXT,
        input REAL, output REAL, cacheRead REAL, cacheWrite REAL, cost REAL, scope TEXT,
        basis TEXT, search TEXT NOT NULL, record TEXT NOT NULL, purpose TEXT, historical INTEGER NOT NULL, conversationId INTEGER NOT NULL, PRIMARY KEY(conversationId,entry)
      );
      CREATE INDEX IF NOT EXISTS domos_usage_date ON domos_usage_index(timestamp DESC,botId,entry);
      CREATE INDEX IF NOT EXISTS domos_usage_bot_date ON domos_usage_index(botId,timestamp DESC,entry);
      CREATE TABLE IF NOT EXISTS domos_usage_progress (botId INTEGER PRIMARY KEY, entry INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS domos_usage_tasks (
        taskId TEXT PRIMARY KEY, botId INTEGER NOT NULL, timestamp INTEGER NOT NULL,
        harness TEXT NOT NULL, provider TEXT, model TEXT, purpose TEXT, search TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS domos_usage_counters (identity TEXT PRIMARY KEY, value REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS domos_usage_skills (taskId TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(taskId,name));
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
      `INSERT INTO domos_usage_index VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(conversationId,entry) DO NOTHING`,
    );
    const sessions =
      (await this.harness.snapshot(BotSessions, context))?.items ?? [];
    const sources = [
      ...botIds.map((botId) => ({ botId, id: botId })),
      ...sessions.filter((item) => botIds.includes(item.botId)),
    ];
    const task = db.prepare(
      `INSERT INTO domos_usage_tasks VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(taskId) DO UPDATE SET provider=COALESCE(excluded.provider,provider), model=COALESCE(excluded.model,model), purpose=COALESCE(excluded.purpose,purpose)`,
    );
    for (const { botId, id: conversationId } of sources) {
      const conversation = await this.harness.conversation(
        conversationId as ConversationId,
        context,
      );
      if (!conversation) continue;
      let through = Number(
        db
          .prepare("SELECT entry FROM domos_usage_progress WHERE botId=?")
          .get(conversationId)?.entry ?? 0,
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
              entry.kind === EngineUsageTaskEntry ||
              entry.kind === "domos.engine-run"
            ) {
              const data = entry.data as {
                taskId?: string;
                timestamp?: number;
                startedAt?: number;
                harness?: string;
                provider?: string;
                model: string | null;
                purpose?: string;
              };
              const id = data.taskId ?? String(entry.byTaskId ?? entry.id);
              const harness = data.harness ?? data.provider ?? "unknown";
              task.run(
                id,
                botId,
                data.timestamp ?? data.startedAt ?? 0,
                harness,
                null,
                data.model,
                data.purpose ?? null,
                [id, harness, data.model, `Bot ${botId}`]
                  .join("\n")
                  .toLocaleLowerCase(),
              );
            }
            if (entry.kind === "domos.engine-message") {
              const message = entry.data as {
                content?: {
                  type: string;
                  name?: string;
                  arguments?: { id?: string };
                }[];
              };
              for (const part of message.content ?? [])
                if (
                  part.type === "toolCall" &&
                  /(?:^|__)skill_read$/.test(part.name ?? "") &&
                  typeof part.arguments?.id === "string"
                )
                  db.prepare(
                    "INSERT OR IGNORE INTO domos_usage_skills VALUES (?,?)",
                  ).run(String(entry.byTaskId), part.arguments.id);
            }
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
            let normalized = { ...original, botId };
            try {
              normalized = usageTokens(normalized, original.harness);
            } catch (error) {
              if (!(error instanceof RangeError)) throw error;
              normalized = {
                ...normalized,
                input: null,
                output: null,
                cacheRead: null,
                cacheWrite: null,
                historical: true,
                pricingReason: error.message,
              };
            }
            if (
              !original.tokenBasis &&
              ["codex", "claude"].includes(original.harness)
            ) {
              normalized = {
                ...normalized,
                input: null,
                output: null,
                cacheRead: null,
                cacheWrite: null,
                historical: true,
                pricingReason: "历史记录缺少可靠累计基线。",
              };
              if (normalized.costBasis === "estimated")
                normalized = { ...normalized, costUsd: null };
            }
            if (
              !original.tokenBasis &&
              original.costCounter &&
              original.costCumulative !== undefined
            ) {
              const current = original.costCumulative;
              const identity = JSON.stringify([
                conversationId,
                original.harness,
                original.costCounter,
              ]);
              const previous = db
                .prepare(
                  "SELECT value FROM domos_usage_counters WHERE identity=?",
                )
                .get(identity)?.value;
              if (Number.isFinite(current) && current >= 0) {
                normalized.costUsd =
                  previous === undefined
                    ? original.costUsd
                    : current < Number(previous)
                      ? null
                      : current - Number(previous);
                if (previous !== undefined && current < Number(previous))
                  normalized.pricingReason =
                    "历史金额计数器重置，当前增量未知。";
                db.prepare(
                  "INSERT INTO domos_usage_counters VALUES (?,?) ON CONFLICT(identity) DO UPDATE SET value=excluded.value",
                ).run(identity, current);
              } else {
                normalized.costUsd = null;
                normalized.historical = true;
                normalized.pricingReason = "历史原生金额无效。";
              }
            }
            const row =
              normalized.costScope === "session" || normalized.historical
                ? normalized
                : priceUsage(
                    normalized,
                    normalized.harness,
                    normalized.timestamp,
                  );
            const search = [
              row.harness,
              row.provider,
              row.model,
              row.source,
              row.taskId,
              row.purpose,
              `Bot ${botId}`,
            ]
              .join("\n")
              .toLocaleLowerCase();
            task.run(
              row.taskId,
              botId,
              row.timestamp,
              row.harness,
              row.provider,
              row.model,
              row.purpose ?? null,
              search,
            );
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
              search,
              JSON.stringify(row),
              row.purpose ?? null,
              row.historical ? 1 : 0,
              conversationId,
            );
          }
          db.prepare(
            "INSERT INTO domos_usage_progress VALUES (?,?) ON CONFLICT(botId) DO UPDATE SET entry=excluded.entry",
          ).run(conversationId, through);
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
  async *export(botIds: number[], filter: UsageFilter, context: Context) {
    await this.sync(botIds, context);
    const { sql, values } = this.where(botIds, filter);
    const ceiling = Number(
      this.database
        .prepare(
          `SELECT MAX(rowid) ceiling FROM domos_usage_index WHERE ${sql}`,
        )
        .get(...values)?.ceiling ?? 0,
    );
    const columns = [
      "timestamp",
      "botId",
      "harness",
      "provider",
      "model",
      "input",
      "cacheRead",
      "cacheWrite",
      "output",
      "costUsd",
      "costBasis",
      "costSource",
      "costVersion",
      "pricingReason",
      "taskId",
      "sessionId",
      "purpose",
      "source",
      "id",
      "nativeTokens",
      "computerId",
      "accountId",
    ] as const;
    const csv = (value: unknown) => {
      const text =
        value == null
          ? ""
          : typeof value === "object"
            ? JSON.stringify(value)
            : String(value);
      return `"${(/^[=+\-@\t\r\n]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`;
    };
    yield `${columns.join(",")}\r\n`;
    let cursor = 0;
    for (;;) {
      context.abortSignal?.throwIfAborted();
      const rows = this.database
        .prepare(
          `SELECT rowid,record FROM domos_usage_index WHERE ${sql} AND rowid>? AND rowid<=? ORDER BY rowid LIMIT 50`,
        )
        .all(...values, cursor, ceiling);
      if (!rows.length) return;
      yield `${rows
        .map((item) => {
          cursor = Number(item.rowid);
          const row = JSON.parse(String(item.record)) as UsageRecord;
          return columns.map((column) => csv(row[column])).join(",");
        })
        .join("\r\n")}\r\n`;
      await setImmediate();
    }
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
    const coverageSQL = `(${sql}) OR taskId IN (SELECT taskId FROM domos_usage_index WHERE ${sql})`;
    const coverageValues = [...values, ...values];
    const health = db
      .prepare(
        `SELECT COUNT(*) tasks, COALESCE(SUM(taskId NOT IN (SELECT taskId FROM domos_usage_index)),0) missingUsage FROM domos_usage_tasks WHERE ${coverageSQL}`,
      )
      .get(...coverageValues) as { tasks: number; missingUsage: number };
    totals.tasks = health.tasks;
    const table =
      metric === "tasks" ? "domos_usage_tasks" : "domos_usage_index";
    const grouped =
      dimension === "skill"
        ? `(SELECT u.*,s.name skill FROM ${table} u JOIN domos_usage_skills s USING(taskId))`
        : table;
    const valueSQL =
      metric === "tasks"
        ? "COUNT(DISTINCT taskId)"
        : metric === "tokens"
          ? "SUM(input+cacheRead+cacheWrite+output)"
          : `SUM(${metric})`;
    const column =
      dimension === "bot"
        ? "CAST(botId AS TEXT)"
        : dimension === "day"
          ? "strftime('%Y-%m-%d',timestamp/1000,'unixepoch')"
          : dimension;
    const groupWhere = metric === "tasks" ? coverageSQL : sql;
    const groupValues = metric === "tasks" ? coverageValues : values;
    const ranked = db
      .prepare(
        `SELECT COALESCE(${column},'未提供') key, ${valueSQL} value FROM ${grouped} WHERE ${groupWhere} GROUP BY key ORDER BY value DESC,key`,
      )
      .all(...groupValues) as { key: string; value: number | null }[];
    const top = ranked.slice(0, limit);
    const keys = top.map((row) => row.key);
    const groupSQL = `CASE WHEN COALESCE(${column},'未提供') IN (${keys.map(() => "?").join(",") || "NULL"}) THEN COALESCE(${column},'未提供') ELSE 'other' END`;
    const daily = db
      .prepare(
        `SELECT strftime('%Y-%m-%d',timestamp/1000,'unixepoch') day, ${groupSQL} key, ${valueSQL} value FROM ${grouped} WHERE ${groupWhere} GROUP BY day,key ORDER BY day,key`,
      )
      .all(...keys, ...groupValues) as {
      day: string;
      key: string;
      value: number | null;
    }[];
    if (ranked.length > limit) {
      const others = db
        .prepare(
          `SELECT ${valueSQL} value FROM ${grouped} WHERE ${groupWhere} AND COALESCE(${column},'未提供') NOT IN (${keys.map(() => "?").join(",") || "NULL"})`,
        )
        .get(...groupValues, ...keys);
      top.push({ key: "other", value: others?.value as number | null });
    }
    const usageGroups =
      dimension === "skill"
        ? "(SELECT u.*,s.name skill FROM domos_usage_index u JOIN domos_usage_skills s USING(taskId))"
        : "domos_usage_index";
    const groupTotals = db
      .prepare(
        `SELECT ${groupSQL} key, ${totalsSQL} FROM ${usageGroups} WHERE ${sql} GROUP BY key`,
      )
      .all(...keys, ...values) as (UsageTotals & { key: string })[];
    const engines = db
      .prepare(
        `SELECT harness key, ${totalsSQL} FROM domos_usage_index WHERE ${sql} GROUP BY harness ORDER BY cost DESC,harness`,
      )
      .all(...values) as (UsageTotals & { key: string })[];
    const days = db
      .prepare(
        `SELECT strftime('%Y-%m-%d',timestamp/1000,'unixepoch') day, ${totalsSQL} FROM domos_usage_index WHERE ${sql} GROUP BY day ORDER BY day`,
      )
      .all(...values) as (UsageTotals & { day: string })[];
    const engineDays = db
      .prepare(
        `SELECT strftime('%Y-%m-%d',timestamp/1000,'unixepoch') day, harness key, ${totalsSQL} FROM domos_usage_index WHERE ${sql} GROUP BY day,harness ORDER BY day,harness`,
      )
      .all(...values) as (UsageTotals & { day: string; key: string })[];
    const options = db
      .prepare(
        `SELECT DISTINCT provider,model FROM domos_usage_index WHERE botId IN (${botIds.map(() => "?").join(",") || "NULL"}) AND timestamp>=? AND timestamp<=?`,
      )
      .all(
        ...botIds,
        filter.from ?? 0,
        filter.to ?? Number.MAX_SAFE_INTEGER,
      ) as { provider: string | null; model: string | null }[];
    const coverage = db
      .prepare(
        `SELECT harness, COUNT(*) tasks, COALESCE(SUM(taskId NOT IN (SELECT taskId FROM domos_usage_index)),0) missingUsage FROM domos_usage_tasks WHERE ${coverageSQL} GROUP BY harness`,
      )
      .all(...coverageValues) as {
      harness: string;
      tasks: number;
      missingUsage: number;
    }[];
    const missingDays = db
      .prepare(
        `SELECT DISTINCT strftime('%Y-%m-%d',timestamp/1000,'unixepoch') day, harness key FROM domos_usage_tasks WHERE (${coverageSQL}) AND taskId NOT IN (SELECT taskId FROM domos_usage_index) ORDER BY day,key`,
      )
      .all(...coverageValues) as { day: string; key: string }[];
    const times = db
      .prepare(
        `SELECT MIN(timestamp) startedAt, MAX(timestamp) updatedAt FROM (SELECT timestamp FROM domos_usage_tasks WHERE botId IN (${botIds.map(() => "?").join(",") || "NULL"}) UNION ALL SELECT timestamp FROM domos_usage_index WHERE botId IN (${botIds.map(() => "?").join(",") || "NULL"})) WHERE timestamp>0`,
      )
      .get(...botIds, ...botIds) as {
      startedAt: number | null;
      updatedAt: number | null;
    };
    const hasSkills = Boolean(
      db
        .prepare(
          `SELECT 1 FROM domos_usage_skills WHERE taskId IN (SELECT taskId FROM domos_usage_tasks WHERE botId IN (${botIds.map(() => "?").join(",") || "NULL"})) LIMIT 1`,
        )
        .get(...botIds),
    );
    return {
      totals,
      groups: top.map((group) => ({
        ...group,
        cost: groupTotals.find((row) => row.key === group.key)?.cost ?? null,
        tokens:
          groupTotals.find((row) => row.key === group.key)?.tokens ?? null,
      })),
      engines,
      daily,
      days,
      engineDays,
      missingDays,
      options,
      missingUsage: health.missingUsage,
      coverage,
      ...times,
      hasSkills,
    };
  }
}
