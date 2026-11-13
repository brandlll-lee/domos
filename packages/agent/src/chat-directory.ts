import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { setImmediate } from "node:timers/promises";
import {
  BACKGROUND_CONTEXT,
  type Context,
} from "@earendil-works/chord/context";
import type {
  CommitChange,
  ConversationId,
  EntryId,
  Harness,
} from "@earendil-works/pi-durable";
import { BotDirectory } from "./bots.ts";
import { chatView } from "./chat-view.ts";
import { ComputerRequests } from "./computer/runtime.ts";
import { BotSessions } from "./conversations.ts";
import { EngineDoc } from "./harness/state.ts";
import type { EngineRun } from "./harness/types.ts";
import { approvalMessage, messageText } from "./messages.ts";
import { TeamsDoc } from "./teams.ts";
import { chatTranscript } from "./transcript.ts";
import { watchCommits } from "./watch.ts";
import { applyRoutineDelivery } from "./work/routine-delivery.ts";
import { RoutinesDoc } from "./work/routine-state.ts";

export type ChatTarget = {
  chat: string;
  botId: number;
  sessionId: number;
  messageId: string;
  cursor?: string;
  turnId?: string;
};
export type ChatSearchResult = ChatTarget & {
  sequence: number;
  name: string;
  avatar: string;
  author: string;
  timestamp: number;
  snippet: string;
};
export type ChatAttention = ChatTarget & {
  sequence: number;
  name: string;
  chatName: string;
  avatar: string;
  text: string;
  kind: "complete" | "failed" | "question" | "approval" | "takeover";
};

type Indexed = {
  sequence: number;
  chat: string;
  botId: number;
  sessionId: number;
  messageId: string;
  cursor: string | null;
  author: string;
  text: string;
  timestamp: number;
};

const catalogChange = (change: CommitChange) =>
  change.type === "entry" ||
  ((change.type === "document" || change.type === "document.copy") &&
    [
      BotDirectory,
      BotSessions,
      TeamsDoc,
      EngineDoc,
      ComputerRequests,
      RoutinesDoc,
    ].some((doc) => doc.definition.kind === change.record.kind));

export class ChatDirectory {
  private database?: DatabaseSync;
  private revision = 0;
  private indexed = -1;
  private pending?: Promise<void>;
  private closed = false;
  private dirty = new Set<number>();
  private all = true;

  private readonly harness: Harness;
  private readonly path: string;
  constructor(harness: Harness, path: string) {
    this.harness = harness;
    this.path = path;
    const unsubscribe = harness.subscribeCommits(({ changes }) => {
      for (const change of changes.filter(catalogChange)) {
        this.revision++;
        if (change.type === "entry")
          this.dirty.add(change.value.conversationId);
        else if (
          change.type === "document" ||
          change.type === "document.copy"
        ) {
          if (
            [
              EngineDoc.definition.kind,
              ComputerRequests.definition.kind,
            ].includes(change.record.kind) &&
            change.conversationId != null
          )
            this.dirty.add(change.conversationId);
          else this.all = true;
        }
      }
    });
    harness.subscribeClose(() => {
      this.closed = true;
      unsubscribe();
      this.database?.close();
      this.database = undefined;
    });
  }

  private db() {
    if (this.closed) throw new Error("聊天服务已关闭。");
    if (this.database) return this.database;
    const db = new DatabaseSync(this.path);
    db.exec(`
      CREATE TABLE IF NOT EXISTS domos_chat_index (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, identity TEXT UNIQUE NOT NULL,
        chat TEXT NOT NULL, botId INTEGER NOT NULL, sessionId INTEGER NOT NULL,
        messageId TEXT NOT NULL, cursor TEXT, turnId TEXT, author TEXT NOT NULL,
        text TEXT NOT NULL, timestamp INTEGER NOT NULL, incoming INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS domos_chat_unread ON domos_chat_index(chat, sessionId, incoming, sequence);
      CREATE VIRTUAL TABLE IF NOT EXISTS domos_chat_search USING fts5(text, content='domos_chat_index', content_rowid='sequence', tokenize='trigram');
      CREATE TABLE IF NOT EXISTS domos_chat_progress (session INTEGER PRIMARY KEY, entry INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS domos_chat_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, identity TEXT UNIQUE NOT NULL,
        chat TEXT NOT NULL, botId INTEGER NOT NULL, sessionId INTEGER NOT NULL,
        messageId TEXT NOT NULL, cursor TEXT, turnId TEXT, text TEXT NOT NULL, kind TEXT NOT NULL
      );
    `);
    this.database = db;
    return db;
  }

  private async channels(context: Context) {
    const [bots, teams, sessions] = await Promise.all([
      this.harness.snapshot(BotDirectory, context),
      this.harness.snapshot(TeamsDoc, context),
      this.harness.snapshot(BotSessions, context),
    ]);
    return (bots?.items ?? []).flatMap((bot) => [
      { chat: `bot/${bot.id}`, bot, name: bot.name, session: bot.id },
      ...(sessions?.items ?? []).flatMap((session) => {
        const team = teams?.items.find((team) => team.id === session.teamId);
        return session.botId === bot.id && team
          ? [
              {
                chat: `team/${team.id}`,
                bot,
                name: team.name,
                session: session.id,
              },
            ]
          : [];
      }),
    ]);
  }

  private async sync() {
    if (this.pending) return this.pending;
    if (this.indexed === this.revision) return;
    this.pending = this.update()
      .catch((error) => {
        this.all = true;
        throw error;
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }

  private async update() {
    const revision = this.revision;
    const db = this.db();
    const context = BACKGROUND_CONTEXT;
    const dirty = this.dirty;
    const all = this.all;
    this.dirty = new Set();
    this.all = false;
    const insert = db.prepare(`INSERT INTO domos_chat_index
      (identity,chat,botId,sessionId,messageId,cursor,turnId,author,text,timestamp,incoming)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(identity) DO NOTHING RETURNING sequence`);
    const event = db.prepare(`INSERT INTO domos_chat_events
      (identity,chat,botId,sessionId,messageId,cursor,turnId,text,kind)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(identity) DO NOTHING`);
    for (const channel of await this.channels(context)) {
      if (this.closed) return;
      const { chat, bot, session } = channel;
      if (!all && !dirty.has(session)) continue;
      const routineRuns =
        (await this.harness.snapshot(RoutinesDoc, context))?.runs.filter(
          (run) => run.botId === session,
        ) ?? [];
      const recordRun = (run: EngineRun) => {
        if (!["ended", "failed", "uncertain"].includes(run.status)) return;
        if (
          routineRuns.some(
            (item) =>
              item.turnId === run.turnId &&
              item.delivery === "conditional" &&
              !item.delivered,
          ) &&
          run.status === "ended"
        )
          return;
        const latest = db
          .prepare(
            "SELECT messageId,cursor,text FROM domos_chat_index WHERE sessionId=? AND turnId=? AND incoming=1 AND cursor IS NOT NULL ORDER BY sequence DESC LIMIT 1",
          )
          .get(session, run.turnId);
        const failed = run.status !== "ended";
        const text = failed
          ? "这项工作未能完成，请查看详情"
          : String(latest?.text ?? "工作已完成").slice(0, 160);
        const id = failed
          ? `failure:${run.turnId}`
          : String(latest?.messageId ?? `run:${run.turnId}`);
        if (failed)
          insert.run(
            `${session}:${id}`,
            chat,
            bot.id,
            session,
            id,
            null,
            run.turnId,
            bot.name,
            text,
            run.endedAt ?? 0,
            1,
          );
        event.run(
          `${session}:run:${run.turnId}`,
          chat,
          bot.id,
          session,
          id,
          latest?.cursor ?? null,
          run.turnId,
          text,
          failed ? "failed" : "complete",
        );
      };
      const conversation = await this.harness.conversation(session, context);
      if (!conversation) continue;
      let through = Number(
        db
          .prepare("SELECT entry FROM domos_chat_progress WHERE session=?")
          .get(session)?.entry ?? 0,
      );
      for (;;) {
        const page = await conversation.entries(
          { order: "ascending", minEntryId: (through + 1) as EntryId },
          200,
          undefined,
          context,
        );
        if (this.closed) return;
        if (!page.items.length) break;
        const view = chatView({
          conversation: { id: session },
          entries: page.items,
          docs: {},
        });
        applyRoutineDelivery(view, routineRuns);
        db.exec("BEGIN");
        try {
          for (const item of chatTranscript(view)) {
            if (item.kind === "notice") continue;
            const message = view.messages.find(
              (message) => message.id === item.id,
            );
            if (!message) continue;
            const text =
              item.kind === "message"
                ? messageText(item.message) ||
                  (item.message.attachments ?? [])
                    .map((file) => file.name)
                    .join(" ")
                : item.files.map((file) => file.name).join(" ");
            if (
              !text.trim() ||
              message.pending ||
              message.stopped ||
              message.parentId
            )
              continue;
            const identity =
              message.role === "user" && message.requestId
                ? `${chat}:request:${message.requestId}`
                : `${session}:${message.id}`;
            const row = insert.get(
              identity,
              chat,
              bot.id,
              session,
              message.id,
              message.cursor ?? null,
              message.turnId ?? null,
              message.role === "user"
                ? "你"
                : (message.author?.name ?? bot.name),
              text,
              message.receivedAt ?? message.timestamp ?? 0,
              Number(message.role !== "user"),
            );
            if (row)
              db.prepare(
                "INSERT INTO domos_chat_search(rowid,text) VALUES (?,?)",
              ).run(Number(row.sequence), text);
          }
          for (const run of view.runs ?? []) recordRun(run);
          through = page.items.at(-1)?.id ?? through;
          db.prepare(
            "INSERT INTO domos_chat_progress VALUES (?,?) ON CONFLICT(session) DO UPDATE SET entry=excluded.entry",
          ).run(session, through);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        await setImmediate();
        if (!page.next) break;
      }
      const [engine, requests] = await Promise.all([
        this.harness.snapshot(EngineDoc, session, context),
        this.harness.snapshot(ComputerRequests, session, context),
      ]);
      if (this.closed) return;
      for (const request of requests?.approvals ?? []) {
        const message = approvalMessage(request, "pending");
        const kind = request.takeover
          ? "takeover"
          : request.kind === "question"
            ? "question"
            : "approval";
        const text =
          `${kind === "takeover" ? "需要你接管" : kind === "question" ? "需要你的回答" : "需要你确认"}：${request.title}`.slice(
            0,
            160,
          );
        insert.run(
          `${session}:${message.id}`,
          chat,
          bot.id,
          session,
          message.id,
          null,
          null,
          bot.name,
          text,
          request.requestedAt ?? 0,
          1,
        );
        event.run(
          `${session}:${message.id}`,
          chat,
          bot.id,
          session,
          message.id,
          null,
          null,
          text,
          kind,
        );
      }
      const run = engine?.run;
      if (run) recordRun(run);
    }
    this.indexed = revision;
  }

  async search(query: string, before: number | undefined, context: Context) {
    await this.sync();
    context.abortSignal?.throwIfAborted();
    const channels = await this.channels(context);
    const allowed = new Map(channels.map((item) => [item.chat, item]));
    const escaped = /[\\%_]/.test(query);
    const pattern = `%${escaped ? query.replace(/[\\%_]/g, "\\$&") : query}%`;
    const rows = this.db()
      .prepare(`SELECT i.* FROM domos_chat_search s JOIN domos_chat_index i ON i.sequence=s.rowid
      WHERE s.text LIKE ? ${escaped ? "ESCAPE '\\'" : ""} AND i.cursor IS NOT NULL AND i.sequence < ?
      AND i.chat IN (SELECT value FROM json_each(?)) ORDER BY i.sequence DESC LIMIT 51`)
      .all(
        pattern,
        before ?? Number.MAX_SAFE_INTEGER,
        JSON.stringify([...allowed.keys()]),
      ) as Indexed[];
    const items: ChatSearchResult[] = rows.slice(0, 50).map((row) => {
      const channel = channels.find((item) => item.session === row.sessionId);
      assert(channel && row.cursor);
      const at = row.text
        .toLocaleLowerCase()
        .indexOf(query.toLocaleLowerCase());
      const start = Math.max(0, at - 45);
      return {
        chat: row.chat,
        botId: row.botId,
        sessionId: row.sessionId,
        messageId: row.messageId,
        cursor: row.cursor,
        sequence: row.sequence,
        name: channel.name,
        avatar: channel.bot.avatar,
        author: row.author,
        timestamp: row.timestamp,
        snippet: `${start ? "…" : ""}${row.text.slice(start, start + 180)}${row.text.length > start + 180 ? "…" : ""}`,
      };
    });
    return {
      items,
      before: rows.length > 50 ? items.at(-1)?.sequence : undefined,
    };
  }

  async receipts(
    chat: string,
    messages: { sessionId: number; messageId: string }[],
    context: Context,
  ) {
    await this.sync();
    const channels = await this.channels(context);
    const sessions = new Set(
      channels.filter((item) => item.chat === chat).map((item) => item.session),
    );
    const receipts: Record<string, number> = {};
    for (const item of messages) {
      if (!sessions.has(item.sessionId as ConversationId)) continue;
      const row = this.db()
        .prepare(
          "SELECT sequence FROM domos_chat_index WHERE chat=? AND sessionId=? AND messageId=? AND incoming=1",
        )
        .get(chat, item.sessionId, item.messageId);
      if (row) {
        const key = `${chat}:${item.sessionId}`;
        receipts[key] = Math.max(receipts[key] ?? 0, Number(row.sequence));
      }
    }
    return receipts;
  }

  async summary(read: Record<string, number>, context: Context) {
    await this.sync();
    context.abortSignal?.throwIfAborted();
    const channels = await this.channels(context);
    const allowed = new Map(channels.map((item) => [item.chat, item]));
    const counts: Record<string, number> = {};
    const count = this.db().prepare(
      "SELECT count(*) AS count FROM domos_chat_index WHERE chat=? AND sessionId=? AND incoming=1 AND sequence>?",
    );
    for (const channel of channels) {
      const key = `${channel.chat}:${channel.session}`;
      counts[channel.chat] =
        (counts[channel.chat] ?? 0) +
        Number(
          count.get(channel.chat, channel.session, read[key] ?? 0)?.count ?? 0,
        );
    }
    const rows = this.db()
      .prepare(
        "SELECT * FROM domos_chat_events WHERE chat IN (SELECT value FROM json_each(?)) ORDER BY sequence DESC LIMIT 50",
      )
      .all(JSON.stringify([...allowed.keys()]));
    const events = rows.reverse().map((row) => {
      const channel = channels.find((item) => item.session === row.sessionId);
      assert(channel);
      return {
        ...row,
        cursor: row.cursor ?? undefined,
        turnId: row.turnId ?? undefined,
        name: channel.bot.name,
        chatName: channel.name,
        avatar: channel.bot.avatar,
      } as ChatAttention;
    });
    return { counts, events };
  }

  watch(read: Record<string, number>, context: Context) {
    return watchCommits(
      this.harness,
      catalogChange,
      () => this.summary(read, context),
      context,
    );
  }
}
