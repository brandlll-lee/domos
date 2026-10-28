import type { Context } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai/models";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import type {
  ConversationId,
  Cursor,
  EntryId,
  EntryRecord,
  Harness,
  TaskId,
} from "@earendil-works/pi-durable";
import {
  CompactionTask,
  defineDoc,
  LiveDoc,
  type LiveState,
} from "@earendil-works/pi-durable";
import { chatView } from "../chat-view.ts";
import { ComputerRequests, type ComputerRuntime } from "../computer/runtime.ts";
import { FileInput, type Files } from "../files.ts";
import type { EngineInput } from "../harness/types.ts";
import { type UsageFilter, UsageReader } from "../harness/usage.ts";
import { materialText } from "../materials.ts";
import { thinkingControl } from "../models.ts";
import { stopChat } from "../stop-chat.ts";
import { watchCommits } from "../watch.ts";
import { actualPrompt } from "../work/prompt.ts";

const CompactionRequests = defineDoc<{ tasks: Record<string, TaskId> }>({
  kind: "domos.compaction-requests",
  version: 1,
  scope: "conversation",
  checkpointWhen: () => false,
  history: "latest",
  fork: "initial",
  initial: () => ({ tasks: {} }),
});

export class Runtime {
  private readonly reader: UsageReader;
  private readonly harness: Harness;
  private readonly models: Models;
  readonly computer?: ComputerRuntime;
  private readonly files?: Files;
  private readonly histories = new Map<number, EntryRecord[]>();
  private readonly contexts = new Map<
    number,
    { key: string; tokens: number }
  >();
  constructor(
    harness: Harness,
    models: Models,
    computer?: ComputerRuntime,
    files?: Files,
  ) {
    this.harness = harness;
    this.models = models;
    this.computer = computer;
    this.files = files;
    this.reader = new UsageReader(harness);
  }
  private async conversation(botId: number, context: Context) {
    const conversation = await this.harness.conversation(
      botId as ConversationId,
      context,
    );
    if (!conversation) throw new Error("Bot 不存在。");
    return conversation;
  }
  async profile(botId: number, context: Context) {
    const conversation = await this.conversation(botId, context);
    const agent = await conversation.agent(context);
    const model = (await this.models.getAvailable()).find(
      (item) =>
        item.provider === agent.model?.provider &&
        item.id === agent.model.modelId,
    );
    return {
      model: model
        ? {
            id: `${model.provider}/${model.id}`,
            name: model.name,
            effort: thinkingControl(model),
          }
        : null,
      config: {
        provider: "pi" as const,
        model: agent.model
          ? `${agent.model.provider}/${agent.model.modelId}`
          : null,
        options: { thinkingLevel: agent.thinkingLevel },
      },
      prepared: Boolean(model),
      busy: (await this.view(botId, context)).busy,
    };
  }
  async view(botId: number, context: Context) {
    const state = await (await this.conversation(botId, context)).viewState(
      context,
    );
    try {
      const requests = await this.harness.snapshot(
        ComputerRequests,
        botId as ConversationId,
        context,
      );
      const conversation = await this.conversation(botId, context);
      const active = state.value.entries;
      const tail = Math.max(active[0]?.id ?? 0, active.at(-1)?.id ?? 0);
      let entries = this.histories.get(botId) ?? [];
      if (tail > (entries.at(-1)?.id ?? 0)) {
        entries = [...entries];
        const query = {
          order: "ascending" as const,
          minEntryId: ((entries.at(-1)?.id ?? 0) + 1) as EntryId,
          maxEntryId: tail as EntryId,
        };
        let cursor: Cursor | undefined;
        do {
          const page = await conversation.entries(query, 500, cursor, context);
          entries.push(...page.items);
          cursor = page.next;
        } while (cursor);
        this.histories.set(botId, entries);
      }
      const view = chatView(
        { ...state.value, entries },
        requests?.approvals ?? [],
      );
      const key = `${active[0]?.id}:${tail}:${JSON.stringify(view.model)}`;
      let cached = this.contexts.get(botId);
      if (cached?.key !== key) {
        cached = {
          key,
          tokens: estimateContextTokens(
            (await conversation.context(context)).messages,
          ).tokens,
        };
        this.contexts.set(botId, cached);
      }
      const model = (await this.models.getAvailable()).find(
        (item) =>
          item.provider === view.model?.provider &&
          item.id === view.model.modelId,
      );
      const live = state.value.docs[LiveDoc.definition.kind] as
        | LiveState
        | undefined;
      return {
        ...view,
        runtime: {
          contextTokens: cached.tokens,
          contextWindow: model?.contextWindow ?? null,
          context: {
            source: "pi-durable",
            basis: "window" as const,
            estimated: true,
            observedAt: Date.now(),
            harness: "pi" as const,
            sessionId: null,
            model: model ? `${model.provider}/${model.id}` : null,
          },
          contextPolicy: {
            manual: true,
            automatic: "native" as const,
            refresh: false,
          },
          ...(live?.compactions?.length
            ? { compaction: "running" as const }
            : live?.compactionFailure
              ? { compaction: "failed" as const }
              : {}),
        },
      };
    } finally {
      state.dispose();
    }
  }
  watch(botId: number, context: Context) {
    return watchCommits(
      this.harness,
      (change) =>
        (change.type === "entry" && change.value.conversationId === botId) ||
        ((change.type === "document" || change.type === "document.copy") &&
          change.conversationId === botId),
      () => this.view(botId, context),
      context,
    );
  }
  async submit(botId: number, input: EngineInput, context: Context) {
    const conversation = await this.conversation(botId, context);
    if (input.operation === "compact")
      throw new Error("请使用上下文压缩入口。");
    await this.computer?.prepare(botId, context);
    const images =
      (await this.files?.images(botId, input.attachments ?? [], context)) ?? [];
    return conversation.submit(
      {
        type: "input",
        content: [
          {
            type: "text",
            text: [
              materialText(input.text, input.materials),
              ...(input.attachments ?? []).map(
                (file) => `Uploaded file: ${file.path}`,
              ),
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
          ...images,
        ],
        requestId: input.requestId,
        whenBusy: input.whenBusy ?? "steer",
        entry: {
          kind: FileInput,
          data: JSON.parse(
            JSON.stringify({
              text: input.text,
              attachments: input.attachments ?? [],
              materials: input.materials,
              requestId: input.requestId,
            }),
          ),
        },
      },
      context,
    );
  }
  async stop(botId: number, context: Context) {
    await stopChat(await this.conversation(botId, context), context);
  }
  async prompt(botId: number, context: Context) {
    return actualPrompt(await this.conversation(botId, context), context);
  }
  usage(botIds: number[], filter: UsageFilter, context: Context) {
    return this.reader.read(botIds, filter, context);
  }
  async compact(botId: number, requestId: string, context: Context) {
    const conversation = await this.conversation(botId, context);
    return conversation.commit(async (tx) => {
      const requests = await tx.doc(CompactionRequests, conversation.id);
      const existing = requests.tasks[requestId];
      if (existing !== undefined) return existing;
      const taskId = await tx.createTask(
        CompactionTask,
        { reason: "manual" },
        { ownership: { kind: "conversation" }, background: false },
      );
      const live = await tx.doc(LiveDoc, conversation.id);
      live.compactions ??= [];
      live.compactions.push({
        taskId,
        reason: "manual",
        blocking: false,
        attempt: 1,
      });
      requests.tasks[requestId] = taskId;
      return taskId;
    }, context);
  }
  async answer(
    botId: number,
    id: string,
    answer: { allow: boolean },
    context: Context,
  ) {
    if (!this.computer) throw new Error("电脑服务不可用。");
    return this.computer.answer(botId, id, answer, context);
  }
  async takeRequest(botId: number, id: string, view: string, context: Context) {
    if (!this.computer) throw new Error("电脑服务不可用。");
    return this.computer.takeRequest(botId, id, view, context);
  }
}
