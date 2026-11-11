import type { Context } from "@earendil-works/chord/context";
import {
  type ConversationId,
  defineDoc,
  type Harness,
} from "@earendil-works/pi-durable";
import { BotDirectory } from "./bots.ts";
import type { ChatView } from "./chat-view.ts";
import { DelegationsDoc } from "./collaboration.ts";
import { BotSessions, createBotSession } from "./conversations.ts";
import type { Runtime } from "./runtime/index.ts";
import { watchCommits } from "./watch.ts";
import { BOT_NAME_LENGTH, WORK_TEXT_LENGTH } from "./work/limits.ts";
import { requiredText, WorkError } from "./work/state.ts";

export type Team = {
  id: string;
  name: string;
  purpose: string;
  members: number[];
  owner: number;
};
export const TeamsDoc = defineDoc<{ items: Team[] }>({
  kind: "domos.teams",
  version: 1,
  scope: "session",
  checkpointWhen: () => false,
  initial: () => ({ items: [] }),
});

export class Teams {
  readonly harness: Harness;
  constructor(harness: Harness) {
    this.harness = harness;
  }
  async list(context: Context) {
    return (await this.harness.snapshot(TeamsDoc, context))?.items ?? [];
  }
  watchList(context: Context) {
    return watchCommits(
      this.harness,
      (change) =>
        (change.type === "document" || change.type === "document.copy") &&
        change.record.kind === TeamsDoc.definition.kind,
      () => this.list(context),
      context,
    );
  }
  async create(input: Team, context: Context) {
    return this.save(input, context, false);
  }
  private async save(input: Team, context: Context, update: boolean) {
    return this.harness.commit(async (tx) => {
      const doc = await tx.doc(TeamsDoc);
      const existing = doc.items.find((item) => item.id === input.id);
      if (existing && !update) return existing;
      if (!existing && update) throw new WorkError("NOT_FOUND", "团队不存在。");
      const bots = await tx.doc(BotDirectory);
      const members = [...new Set(input.members)];
      if (
        !members.includes(input.owner) ||
        members.some((id) => !bots.items.some((bot) => bot.id === id))
      )
        throw new WorkError(
          "BAD_REQUEST",
          "请选择现有 Bot，并从成员中选择负责人。",
        );
      const team = {
        ...input,
        name: requiredText(input.name, BOT_NAME_LENGTH),
        purpose: input.purpose.trim(),
        members,
      };
      if (team.purpose.length > WORK_TEXT_LENGTH)
        throw new WorkError("BAD_REQUEST", "团队用途过长。");
      if (existing) Object.assign(existing, team);
      else doc.items.push(team);
      return team;
    }, context);
  }
  async update(input: Team, runtime: Runtime, context: Context) {
    const team = await this.save(input, context, true);
    const removed =
      (await this.harness.snapshot(BotSessions, context))?.items
        .filter(
          (item) =>
            item.teamId === team.id && !team.members.includes(item.botId),
        )
        .map((item) => item.botId) ?? [];
    await this.stop(team.id, runtime, context, removed);
    return team;
  }
  async session(id: string, botId: number | undefined, context: Context) {
    const team = (await this.list(context)).find((item) => item.id === id);
    if (!team) throw new WorkError("NOT_FOUND", "团队不存在。");
    const recipient = botId ?? team.owner;
    if (!team.members.includes(recipient))
      throw new WorkError("BAD_REQUEST", "Bot 不在此团队中。");
    return createBotSession(
      this.harness,
      recipient as ConversationId,
      { purpose: "team", teamId: id, key: `team:${id}` },
      context,
    );
  }
  async stop(
    id: string,
    runtime: Runtime,
    context: Context,
    members?: number[],
  ) {
    const sessions =
      (await this.harness.snapshot(BotSessions, context))?.items.filter(
        (item) =>
          item.teamId === id && (!members || members.includes(item.botId)),
      ) ?? [];
    const sessionIds = new Set(sessions.map((item) => item.id));
    for (const item of (await this.harness.snapshot(DelegationsDoc, context))
      ?.items ?? [])
      if (sessionIds.has(item.source) || sessionIds.has(item.session))
        await runtime.collaboration?.cancel(item.id, context);
    await Promise.all(sessions.map((item) => runtime.stop(item.id, context)));
  }
  async view(
    id: string,
    runtime: Runtime,
    context: Context,
    before?: string,
  ): Promise<ChatView> {
    const session = await this.session(id, undefined, context);
    const bots =
      (await this.harness.snapshot(BotDirectory, context))?.items ?? [];
    const sessions =
      (await this.harness.snapshot(BotSessions, context))?.items.filter(
        (item) => item.teamId === id,
      ) ?? [];
    const views = await Promise.all(
      sessions.map(async (item) => {
        const view = await runtime.view(item.id, context, {
          limit: 200,
          before,
        });
        const bot = bots.find((bot) => bot.id === item.botId)!;
        return {
          ...view,
          runs: view.runs?.map((run) => ({
            ...run,
            sessionId: item.id,
          })),
          messages: view.messages.map((message) => ({
            ...message,
            sessionId: item.id,
            ...(message.role !== "user" && !message.author
              ? {
                  author: { botId: bot.id, name: bot.name, avatar: bot.avatar },
                }
              : {}),
          })),
        };
      }),
    );
    const base = views.find((view) => view.id === session)!;
    const requests = new Set<string>();
    const messages = views
      .flatMap((view) => view.messages)
      .sort((a, b) => {
        const entry = (cursor: string | undefined) =>
          Number(cursor?.split(":")[0] ?? Number.MAX_SAFE_INTEGER);
        return (
          entry(a.cursor) - entry(b.cursor) ||
          (a.timestamp ?? 0) - (b.timestamp ?? 0)
        );
      })
      .filter((message) => {
        if (message.role !== "user" || !message.requestId) return true;
        if (requests.has(message.requestId)) return false;
        requests.add(message.requestId);
        return true;
      });
    const page = messages.slice(-200);
    return {
      ...base,
      messages: page,
      before:
        messages.length > page.length || views.some((view) => view.before)
          ? page[0]?.cursor
          : undefined,
      busy: views.some((view) => view.busy),
      processing: views.some((view) => view.processing),
      activity: [
        ...new Map(
          views
            .flatMap((view) => view.activity ?? [])
            .map((item) => {
              const bot = bots.find((bot) => bot.id === item.botId);
              return [
                item.sessionId,
                {
                  ...item,
                  ...(bot
                    ? {
                        author: {
                          botId: bot.id,
                          name: bot.name,
                          avatar: bot.avatar,
                        },
                      }
                    : {}),
                },
              ] as const;
            }),
        ).values(),
      ],
      delegations: views.flatMap((view) => view.delegations ?? []),
      approvals: views.flatMap((view) => view.approvals ?? []),
      runs: views.flatMap((view) => view.runs ?? []),
    };
  }
  watch(id: string, runtime: Runtime, context: Context) {
    return watchCommits(
      this.harness,
      (change) =>
        change.type === "entry" ||
        change.type === "task" ||
        change.type === "document" ||
        change.type === "document.copy",
      () => this.view(id, runtime, context),
      context,
    );
  }
}
