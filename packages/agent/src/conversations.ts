import type { Context } from "@earendil-works/chord/context";
import {
  type ConversationId,
  configure,
  type DocumentReader,
  defineDoc,
  type Harness,
} from "@earendil-works/pi-durable";
import { BotDirectory } from "./bots.ts";
import { EngineDoc } from "./harness/state.ts";
import { stored } from "./harness/task-types.ts";
import { WorkError } from "./work/state.ts";

export const BotSession = defineDoc<{
  botId: ConversationId | null;
  purpose: "private" | "team" | "delegation";
  teamId?: string;
  origin?: number;
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
    purpose: "team" | "delegation";
    teamId?: string;
    origin?: number;
    key?: string;
  },
  context: Context,
) {
  const bot = (await harness.snapshot(BotDirectory, context))?.items.find(
    (item) => item.id === botId,
  );
  const source = bot && (await harness.conversation(botId, context));
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
    Object.assign(await tx.doc(BotSession, session.id), { botId, ...input });
    directory.items.push(
      stored({ id: session.id, botId, key: input.key, teamId: input.teamId }),
    );
    (await tx.doc(EngineDoc, session.id)).config = stored(
      (await tx.doc(EngineDoc, botId)).config,
    );
    return session.id;
  }, context);
}
