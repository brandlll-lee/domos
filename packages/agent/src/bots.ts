import { randomUUID } from "node:crypto";
import type { Context } from "@earendil-works/chord/context";
import {
  type ConversationId,
  configure,
  defineDoc,
  type Harness,
  type ModelRef,
} from "@earendil-works/pi-durable";

export type Bot = { id: ConversationId; name: string; avatar: string };
export type CreateBot = {
  name: string;
  instructions: string;
  model: ModelRef;
  requestId: string;
  avatar?: string;
};

const BotDirectory = defineDoc<{
  items: (Bot & { requestId: string | null })[];
}>({
  kind: "domos.bots",
  version: 1,
  scope: "session",
  initial: () => ({ items: [] }),
});

export class Bots {
  private readonly harness: Harness;

  constructor(harness: Harness) {
    this.harness = harness;
  }

  async initialize(conversationId: ConversationId, context: Context) {
    await this.harness.commit(async (tx) => {
      const directory = await tx.doc(BotDirectory);
      if (!directory.items.some((bot) => bot.id === conversationId))
        directory.items.push({
          id: conversationId,
          name: "Domos",
          avatar: randomUUID(),
          requestId: null,
        });
      for (const bot of directory.items) bot.avatar ??= randomUUID();
    }, context);
  }

  async list(context: Context): Promise<Bot[]> {
    const directory = await this.harness.snapshot(BotDirectory, context);
    return (
      directory?.items.map(({ id, name, avatar }) => ({ id, name, avatar })) ??
      []
    );
  }

  async conversation(id: number, context: Context) {
    const bot = (await this.list(context)).find((item) => item.id === id);
    return bot ? this.harness.conversation(bot.id, context) : undefined;
  }

  async create(input: CreateBot, context: Context): Promise<Bot> {
    return this.harness.commit(async (tx) => {
      const directory = await tx.doc(BotDirectory);
      const existing = directory.items.find(
        (bot) => bot.requestId === input.requestId,
      );
      if (existing)
        return {
          id: existing.id,
          name: existing.name,
          avatar: existing.avatar,
        };
      const conversation = await tx.createConversation({
        ownership: { kind: "ownerless" },
      });
      await configure(tx, conversation.id, {
        model: input.model,
        instructions: input.instructions,
      });
      const bot = {
        id: conversation.id,
        name: input.name,
        avatar: input.avatar ?? randomUUID(),
      };
      directory.items.push({ ...bot, requestId: input.requestId });
      return bot;
    }, context);
  }

  async watch(context: Context) {
    const watch = await this.harness.watchDoc(BotDirectory, context);
    if (!watch) throw new Error("Bot directory is unavailable");
    return watch;
  }
}
