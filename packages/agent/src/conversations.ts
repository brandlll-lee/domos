import type { Context } from "@earendil-works/chord/context";
import {
  type ConversationId,
  configure,
  type DocumentReader,
  defineDoc,
  type Harness,
  LiveDoc,
  type Tx,
} from "@earendil-works/pi-durable";
import { botPreview } from "./bot-preview.ts";
import { BotDirectory } from "./bots.ts";
import { ComputerRequests } from "./computer/runtime.ts";
import { EngineDoc } from "./harness/state.ts";
import { stored } from "./harness/task-types.ts";
import type { EngineId } from "./harness/types.ts";
import { WorkError } from "./work/state.ts";

export const BotSession = defineDoc<{
  botId: ConversationId | null;
  purpose: "private" | "team" | "delegation";
  teamId?: string;
  origin?: number;
  title?: string;
  archived?: boolean;
  createdAt?: number;
}>({
  kind: "domos.bot-session",
  version: 1,
  scope: "conversation",
  checkpointWhen: () => false,
  history: "latest",
  fork: "initial",
  initial: () => ({ botId: null, purpose: "private" }),
});

export const BotSessions = defineDoc<{
  items: {
    id: ConversationId;
    botId: ConversationId;
    key?: string;
    teamId?: string;
  }[];
}>({
  kind: "domos.bot-sessions",
  version: 1,
  scope: "session",
  checkpointWhen: () => false,
  initial: () => ({ items: [] }),
});

export async function namePrivateSession(
  tx: Tx,
  id: ConversationId,
  text: string,
) {
  const title = text
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim();
  if (!title) return;
  const session = await tx.doc(BotSession, id);
  if (session.purpose === "private" && !session.title)
    session.title = Array.from(title).slice(0, 40).join("");
}

export async function owningBot(
  read: DocumentReader,
  id: ConversationId,
  context: Context,
) {
  return (await read.snapshot(BotSession, id, context))?.botId ?? id;
}

export async function createBotSession(
  harness: Harness,
  botId: ConversationId,
  input: {
    purpose: "private" | "team" | "delegation";
    teamId?: string;
    origin?: number;
    key?: string;
    source?: number;
  },
  context: Context,
) {
  const bot = (await harness.snapshot(BotDirectory, context))?.items.find(
    (item) => item.id === botId,
  );
  if (input.source !== undefined)
    await privateSession(harness, botId, input.source, context);
  const source =
    bot &&
    (await harness.conversation(
      (input.source ?? botId) as ConversationId,
      context,
    ));
  if (!source) throw new WorkError("NOT_FOUND", "Bot 不存在。");
  const agent = await source.agent(context);
  return harness.commit(async (tx) => {
    const directory = await tx.doc(BotSessions);
    const existing =
      input.key &&
      directory.items.find(
        (item) => item.key === input.key && item.botId === botId,
      );
    if (existing) return existing.id;
    const session = await tx.createConversation({
      ownership: { kind: "ownerless" },
    });
    await configure(tx, session.id, {
      model: agent.model,
      instructions: agent.instructions,
    });
    Object.assign(await tx.doc(BotSession, session.id), {
      botId,
      purpose: input.purpose,
      teamId: input.teamId,
      origin: input.origin,
      createdAt: Date.now(),
    });
    directory.items.push(
      stored({ id: session.id, botId, key: input.key, teamId: input.teamId }),
    );
    (await tx.doc(EngineDoc, session.id)).config = stored(
      (await tx.doc(EngineDoc, source.id)).config,
    );
    return session.id;
  }, context);
}

export async function privateSession(
  harness: Harness,
  botId: number,
  id: number,
  context: Context,
) {
  const bot = (await harness.snapshot(BotDirectory, context))?.items.find(
    (item) => item.id === botId,
  );
  const session = await harness.snapshot(
    BotSession,
    id as ConversationId,
    context,
  );
  if (
    !bot ||
    (id !== botId &&
      (session?.botId !== botId || session.purpose !== "private"))
  )
    throw new WorkError("NOT_FOUND", "会话不存在。");
  return session;
}

export type PrivateConversation = {
  id: number;
  provider: EngineId | undefined;
  title: string;
  archived: boolean;
  createdAt?: number;
  updatedAt?: number;
  status: "idle" | "working" | "queued" | "waiting" | "failed";
};

export async function privateConversations(
  harness: Harness,
  botId: ConversationId,
  context: Context,
): Promise<PrivateConversation[]> {
  const directory = (await harness.snapshot(BotSessions, context))?.items ?? [];
  const ids = [
    botId,
    ...directory.filter((item) => item.botId === botId).map((item) => item.id),
  ];
  const items = await Promise.all(
    ids.map(async (id) => {
      const [session, engine, live, requests, conversation] = await Promise.all(
        [
          harness.snapshot(BotSession, id, context),
          harness.snapshot(EngineDoc, id, context),
          harness.snapshot(LiveDoc, id, context),
          harness.snapshot(ComputerRequests, id, context),
          harness.conversation(id, context),
        ],
      );
      if ((id !== botId && session?.purpose !== "private") || !conversation)
        return [];
      const preview = await botPreview(conversation, "", context);
      const status: PrivateConversation["status"] = requests?.approvals.length
        ? "waiting"
        : engine?.tasks.length || live?.run
          ? engine?.run?.status === "running" || live?.run
            ? "working"
            : "queued"
          : engine?.error ||
              engine?.run?.status === "failed" ||
              engine?.run?.status === "uncertain"
            ? "failed"
            : "idle";
      return [
        {
          id,
          provider: engine?.config.provider,
          title:
            session?.title ?? (preview.lastMessageAt ? "原有会话" : "新会话"),
          archived: session?.archived ?? false,
          createdAt: session?.createdAt,
          updatedAt: preview.lastMessageAt ?? session?.createdAt,
          status,
        },
      ];
    }),
  );
  return items
    .flat()
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || b.id - a.id);
}

export async function updatePrivateSession(
  harness: Harness,
  botId: number,
  id: number,
  input: { title?: string; archived?: boolean },
  context: Context,
) {
  await privateSession(harness, botId, id, context);
  await harness.commit(async (tx) => {
    const session = await tx.doc(BotSession, id as ConversationId);
    if (input.title !== undefined) session.title = input.title;
    if (input.archived !== undefined) session.archived = input.archived;
  }, context);
}
