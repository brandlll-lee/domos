import type { Context } from "@earendil-works/chord/context";
import {
  AgentDoc,
  type ConversationId,
  type Cursor,
  type EntryId,
  type EntryRecord,
  type Harness,
  LiveDoc,
} from "@earendil-works/pi-durable";
import { chatView } from "../chat-view.ts";
import { ComputerRequests } from "../computer/runtime.ts";
import { EngineConnections } from "../harness/connections.ts";
import type { EngineExecution } from "../harness/execution.ts";
import { EngineModelCatalog } from "../harness/model-catalog.ts";
import { engineProvider, providers } from "../harness/providers/index.ts";
import {
  readEngine,
  reconcileEngine,
  stopEngine,
} from "../harness/reconcile.ts";
import { switchSession } from "../harness/sessions.ts";
import { EngineDoc, EngineInputDoc, EngineMessage } from "../harness/state.ts";
import { engineTask } from "../harness/task.ts";
import { type EngineTaskInput, userMessage } from "../harness/task-types.ts";
import type {
  EngineAnswer,
  EngineConfig,
  EngineInput,
} from "../harness/types.ts";
import { type UsageFilter, UsageReader } from "../harness/usage.ts";
import { materialText } from "../materials.ts";
import { approvalMessage } from "../messages.ts";
import { watchCommits } from "../watch.ts";
import { WorkError } from "../work/state.ts";

export function slimChatView(view: import("../chat-view.ts").ChatView) {
  const slim = (message: import("../messages.ts").ChatMessage) => {
    if (message.role === "toolResult")
      return {
        ...message,
        native: message.native
          ? {
              type: message.native.type,
              status: message.native.status,
              exitCode: message.native.exitCode,
              durationMs: message.native.durationMs,
            }
          : undefined,
        content: [],
        detail: true,
      };
    const images = message.content.some((part) => part.type === "image");
    return images
      ? {
          ...message,
          detail: true,
          content: message.content.map((part) =>
            part.type === "image" ? { ...part, data: "" } : part,
          ),
        }
      : message;
  };
  return {
    ...view,
    approvals: view.approvals?.map(
      ({ preview: _preview, ...request }) => request,
    ),
    messages: view.messages.map(slim),
    draft: view.draft ? slim(view.draft) : null,
  };
}

export class Runtime {
  private readonly stopping = new Set<number>();
  private readonly usageReader: UsageReader;
  private readonly harness: Harness;
  readonly execution: EngineExecution;
  readonly task;
  readonly connections;
  constructor(harness: Harness, execution: EngineExecution) {
    this.harness = harness;
    this.execution = execution;
    this.task = engineTask(execution);
    this.connections = new EngineConnections(
      execution,
      new EngineModelCatalog(harness),
    );
    this.usageReader = new UsageReader(harness);
  }

  async profile(botId: number, context: Context) {
    const id = botId as ConversationId;
    const [doc, agent] = await Promise.all([
      readEngine(this.harness, id, context),
      this.harness.snapshot(AgentDoc, id, context),
    ]);
    const computerId = await this.execution.computers.computerId(
      botId,
      context,
    );
    const config = doc?.config ?? {
      provider: "pi" as const,
      model: agent?.model
        ? `${agent.model.provider}/${agent.model.modelId}`
        : null,
    };
    const models = await this.connections.catalog(botId, context, config);
    return {
      config,
      computerId,
      catalog: models,
      connection: await this.connections.snapshot(botId, config, context),
      model:
        models
          .find((item) => item.id === config.provider)
          ?.models.find((item) => item.id === config.model) ?? null,
      revision: doc?.revision ?? 0,
      runtime:
        doc?.computerId && doc.computerId !== computerId
          ? null
          : (doc?.runtime ?? null),
      busy: Boolean(doc?.tasks.length),
      error: doc?.error ?? null,
      prepared: Boolean(
        doc?.prepared &&
          (doc.preparedComputerId ?? doc.computerId) === computerId,
      ),
      providers: [...providers.values()].map(({ id, name, capabilities }) => ({
        id,
        name,
        capabilities,
      })),
    };
  }

  usage(botIds: number[], filter: UsageFilter, context: Context) {
    return this.usageReader.read(botIds, filter, context);
  }

  async view(
    botId: number,
    context: Context,
    page?: { before?: string; limit: number },
  ) {
    const conversation = await this.harness.conversation(
      botId as ConversationId,
      context,
    );
    if (!conversation) throw new WorkError("NOT_FOUND", "Bot 不存在。");
    const engine = await readEngine(
      this.harness,
      botId as ConversationId,
      context,
    );
    const [agent, live] = await Promise.all([
      this.harness.snapshot(AgentDoc, botId as ConversationId, context),
      this.harness.snapshot(LiveDoc, botId as ConversationId, context),
    ]);
    const entries: EntryRecord[] = [];
    const [beforeEntry = 0, beforeIndex = 0] =
      page?.before?.split(":").map(Number) ?? [];
    let cursor: Cursor | undefined;
    do {
      const batch = await conversation.entries(
        {
          order: page ? "descending" : "ascending",
          ...(beforeEntry ? { maxEntryId: beforeEntry as EntryId } : {}),
        },
        page?.limit ?? 500,
        cursor,
        context,
      );
      entries.push(...batch.items);
      cursor = batch.next;
    } while (!page && cursor);
    if (page) entries.reverse();
    const requests = await this.harness.snapshot(
      ComputerRequests,
      botId as ConversationId,
      context,
    );
    const view = chatView(
      {
        conversation,
        entries,
        docs: {
          ...(agent ? { [AgentDoc.definition.kind]: agent } : {}),
          ...(live ? { [LiveDoc.definition.kind]: live } : {}),
        },
      },
      requests?.approvals ?? [],
    );
    if (page) {
      const messages = view.messages.filter((message) => {
        if (!beforeEntry || !message.cursor) return true;
        const [entry = 0, index = 0] = message.cursor.split(":").map(Number);
        return (
          entry < beforeEntry || (entry === beforeEntry && index < beforeIndex)
        );
      });
      view.messages = messages.slice(-page.limit);
      if (cursor || messages.length > page.limit)
        view.before = view.messages[0]?.cursor ?? `${entries[0]?.id}:0`;
    }
    const saved = new Set(view.messages.map((message) => message.id));
    view.messages.push(
      ...(engine?.drafts ?? []).filter((message) => !saved.has(message.id)),
    );
    view.busy ||= Boolean(engine?.tasks.length);
    view.processing = Boolean(
      engine?.activeId &&
        engine.runtime?.processing &&
        !requests?.approvals.length,
    );
    view.activeTurnId = engine?.activeTurn ?? view.activeTurnId;
    view.engine = engine?.config;
    if (engine?.config.model) {
      const separator = engine.config.model.indexOf("/");
      view.model =
        engine.config.provider === "pi" && separator > 0
          ? {
              provider: engine.config.model.slice(0, separator),
              modelId: engine.config.model.slice(separator + 1),
            }
          : {
              provider: engine.config.provider,
              modelId: engine.config.model,
            };
    }
    view.runs = [
      ...(view.runs ?? []).filter((run) => run.turnId !== engine?.run?.turnId),
      ...(engine?.run ? [engine.run] : []),
    ];
    view.runtime = engine?.runtime;
    view.error = engine?.error;
    view.failed ||= Boolean(engine?.error);
    return view;
  }

  async message(
    botId: number,
    id: string,
    cursor: string | undefined,
    context: Context,
  ) {
    if (!cursor) {
      const request = (
        await this.harness.snapshot(
          ComputerRequests,
          botId as ConversationId,
          context,
        )
      )?.approvals.find((item) => approvalMessage(item, "pending").id === id);
      if (request) return approvalMessage(request, "pending");
      const doc = await readEngine(
        this.harness,
        botId as ConversationId,
        context,
      );
      return (
        (
          doc?.drafts as import("../messages.ts").ChatMessage[] | undefined
        )?.find((message) => message.id === id) ?? null
      );
    }
    const conversation = await this.harness.conversation(
      botId as ConversationId,
      context,
    );
    if (!conversation) throw new WorkError("NOT_FOUND", "Bot 不存在。");
    const entryId = Number(cursor.split(":")[0]) as EntryId;
    const batch = await conversation.entries(
      { minEntryId: entryId, maxEntryId: entryId },
      1,
      undefined,
      context,
    );
    return (
      chatView({ conversation, entries: batch.items, docs: {} }).messages.find(
        (message) => message.id === id,
      ) ?? null
    );
  }

  watch(botId: number, context: Context, page?: { limit: number }) {
    return watchCommits(
      this.harness,
      (change) =>
        (change.type === "entry" && change.value.conversationId === botId) ||
        (change.type === "task" &&
          change.value.conversationId === botId &&
          change.value.state.status === "terminal") ||
        ((change.type === "document" || change.type === "document.copy") &&
          change.conversationId === botId),
      async () => {
        const view = await this.view(botId, context, page);
        return page ? slimChatView(view) : view;
      },
      context,
    );
  }

  async *updates(botId: number, context: Context) {
    let previous: import("../chat-view.ts").ChatView | undefined;
    for await (const view of this.watch(botId, context, { limit: 200 })) {
      if (!previous) yield { type: "snapshot" as const, view };
      else {
        const known = new Map(
          previous.messages.map((message) => [message.id, message]),
        );
        const messages = view.messages.filter(
          (message) =>
            JSON.stringify(known.get(message.id)) !== JSON.stringify(message),
        );
        const retained = new Set(view.messages.map((message) => message.id));
        const removed = previous.messages
          .filter((message) => !message.cursor && !retained.has(message.id))
          .map((message) => message.id);
        const state: Partial<Omit<typeof view, "messages" | "before">> = {};
        for (const key of Object.keys(view) as (keyof typeof view)[]) {
          if (key === "messages" || key === "before") continue;
          if (JSON.stringify(previous[key]) !== JSON.stringify(view[key]))
            Object.assign(state, { [key]: view[key] });
        }
        yield { type: "update" as const, state, messages, removed };
      }
      previous = view;
    }
  }

  async prompt(botId: number, context: Context) {
    const doc = await this.harness.snapshot(
      EngineDoc,
      botId as ConversationId,
      context,
    );
    return {
      ...(doc?.prompt ?? { text: "", sections: {}, tools: [] }),
      prepared: Boolean(doc?.prompt),
    };
  }

  async controls(botId: number, context: Context) {
    const id = botId as ConversationId;
    const profile = await this.profile(botId, context);
    if (profile.busy) throw new WorkError("CONFLICT", "请先停止 Bot 的工作。");
    const doc = await this.harness.snapshot(EngineDoc, id, context);
    const computerId = await this.execution.computers.computerId(
      botId,
      context,
    );
    if (
      doc?.runtime?.controls &&
      (doc.preparedComputerId ?? doc.computerId) === computerId
    )
      return doc.runtime.controls;
    const controls = await this.connections.controls(
      botId,
      profile.config,
      doc?.sessionId ?? null,
      context,
    );
    await this.harness.commit(async (tx) => {
      const current = await tx.doc(EngineDoc, id);
      if (current.tasks.length || current.revision !== profile.revision)
        throw new WorkError("CONFLICT", "配置已更新。请重新读取。");
      current.runtime = {
        ...current.runtime,
        controls,
        nativeSkills: controls.skills,
      };
      current.preparedComputerId = computerId;
    }, context);
    return controls;
  }

  async select(
    botId: number,
    input: {
      model: string | null;
      options?: Record<string, string>;
      revision: number;
      requestId: string;
    },
    context: Context,
  ) {
    const profile = await this.profile(botId, context);
    const available = await this.connections.inspect(
      botId,
      profile.config,
      context,
    );
    if (
      !available.authenticated ||
      (input.model &&
        !available.models.some((model) => model.id === input.model))
    )
      throw new WorkError("BAD_REQUEST", "请选择工作电脑上可用的模型。");
    const { options: _options, ...selected } = profile.config;
    return this.configure(
      botId,
      {
        revision: input.revision,
        requestId: input.requestId,
        config: {
          ...selected,
          model: input.model,
          ...(input.options ? { options: input.options } : {}),
        },
      },
      context,
    );
  }

  async configure(
    botId: number,
    input: { config: EngineConfig; revision: number; requestId: string },
    context: Context,
  ) {
    engineProvider(input.config.provider);
    const previous = await readEngine(
      this.harness,
      botId as ConversationId,
      context,
    );
    if (previous?.requestId === input.requestId)
      return this.profile(botId, context);
    if (this.connections.busy(botId))
      throw new WorkError("CONFLICT", "请先完成账号连接。");
    const connection = await this.connections.snapshot(
      botId,
      input.config,
      context,
    );
    const computerId = await this.execution.computers.computerId(
      botId,
      context,
    );
    const models = await this.connections.catalog(botId, context, input.config);
    const effort = models
      .find((item) => item.id === input.config.provider)
      ?.models.find((item) => item.id === input.config.model)?.effort;
    await this.harness.commit(async (tx) => {
      const doc = await tx.doc(EngineDoc, botId as ConversationId);
      if (doc.requestId === input.requestId) return;
      if (
        doc.tasks.length ||
        (await tx.doc(LiveDoc, botId as ConversationId)).run
      )
        throw new WorkError("CONFLICT", "请先停止 Bot 的工作。");
      if (doc.revision !== input.revision)
        throw new WorkError("CONFLICT", "配置已更新。请刷新后重试。");
      const reset =
        doc.config.provider !== input.config.provider ||
        doc.config.model !== input.config.model ||
        doc.config.command !== input.config.command ||
        JSON.stringify(doc.config.args) !== JSON.stringify(input.config.args);
      for (const [key, value] of Object.entries(input.config.options ?? {})) {
        const control =
          (reset
            ? undefined
            : doc.runtime?.controls?.options.find((item) => item.id === key)) ??
          (effort?.id === key ? effort : undefined);
        if (!control?.options.some((item) => item.id === value))
          throw new WorkError(
            "BAD_REQUEST",
            "请先读取此模型的原生配置，再选择可用值。",
          );
      }
      switchSession(doc, input.config, computerId);
      doc.config = input.config;
      doc.revision++;
      doc.requestId = input.requestId;
      if (!reset) {
        if (doc.runtime) doc.runtime.controls = undefined;
        return;
      }
      doc.runtime = {};
      doc.turnId = null;
      doc.dispatch = "ready";
      doc.error = null;
      doc.prepared = Boolean(
        connection?.authenticated &&
          (input.config.model === null ||
            connection.models.some((item) => item.id === input.config.model)),
      );
      doc.preparedComputerId = computerId;
      doc.prompt = null;
    }, context);
    return this.profile(botId, context);
  }

  async compact(botId: number, requestId: string, context: Context) {
    const result = await this.submit(
      botId,
      { text: "", requestId, operation: "compact", whenBusy: "reject" },
      context,
    );
    return result.id;
  }

  async submit(botId: number, input: EngineInput, context: Context) {
    const id = botId as ConversationId;
    await this.cancelMemoryReview(botId, context);
    if (this.connections.busy(botId))
      throw new WorkError("CONFLICT", "请先完成账号连接。");
    await this.execution.computers.preflight(botId, context);
    if (!(await readEngine(this.harness, id, context))?.tasks.length)
      await this.execution.computer.prepare(botId, context);
    const computerId = await this.execution.computers.computerId(
      botId,
      context,
    );
    if (!computerId)
      throw new WorkError("BAD_REQUEST", "请选择这个 Bot 的工作电脑。");
    const submissionId = await this.harness.commit(async (tx) => {
      const existing = await tx.submissionByRequest(id, input.requestId);
      if (existing) return existing.id;
      if (this.stopping.has(botId))
        throw new WorkError("CONFLICT", "正在停止。请稍后发送。");
      const doc = await reconcileEngine(tx, id);
      if (
        (await tx.doc(LiveDoc, id)).run ||
        (doc.tasks.length && input.whenBusy === "reject")
      )
        throw new WorkError("CONFLICT", "Bot 正在工作。请稍后发送。");
      if (doc.computerId !== computerId) {
        switchSession(doc, doc.config, computerId);
        doc.runtime = {};
      }
      const submission = await tx.createSubmission({
        type: "input",
        conversationId: id,
        requestId: input.requestId,
        status: "queued",
      });
      const turnId = `engine:${submission.id}`;
      const entry = await tx.appendEntry(id, {
        kind: input.operation ? "domos.engine-operation" : EngineMessage,
        data: input.operation
          ? { operation: input.operation }
          : userMessage(
              turnId,
              input.displayText ?? input.text,
              input.attachments,
              input.requestId,
              input.materials,
            ),
      });
      tx.placeSubmission(submission.id, entry.id);
      const taskId = await tx.createTask(
        this.task,
        {
          text: [
            materialText(input.text, input.materials),
            ...(input.attachments ?? []).map(
              (file) => `Uploaded file: ${file.path}`,
            ),
          ].join("\n\n"),
          submissionId: submission.id,
          previous: doc.taskId,
          turnId,
          ...(input.source ? { source: input.source } : {}),
          ...(input.routineRunId ? { routineRunId: input.routineRunId } : {}),
          entryId: entry.id,
          ...(input.operation ? { operation: input.operation } : {}),
          ...(input.attachments?.length
            ? { attachments: input.attachments }
            : {}),
        },
        {
          ownership: { kind: "conversation" },
          conversationId: id,
          background: true,
        },
      );
      doc.taskId = taskId;
      doc.tasks.push(taskId);
      if (input.whenBusy === "followUp")
        (await tx.doc(EngineInputDoc, taskId)).status = "deferred";
      return submission.id;
    }, context);
    this.execution.deliver(botId);
    const submission = await this.harness.submission(submissionId, context);
    if (!submission) throw new Error("任务记录不存在。");
    return submission;
  }

  async cancelMemoryReview(botId: number, context: Context) {
    const tasks = await this.harness.commit(async (tx) => {
      const doc = await tx.doc(EngineDoc, botId as ConversationId);
      const tasks = await Promise.all(doc.tasks.map((id) => tx.task(id)));
      return tasks.flatMap((task) =>
        task && (task.input as EngineTaskInput).memoryReview ? [task.id] : [],
      );
    }, context);
    if (!tasks.length) return;
    await this.execution.stopMemoryReview(botId);
    for (const id of tasks) {
      await this.harness.abortTask(id, context);
      await this.harness.waitForTask(id, context);
    }
  }

  async stop(botId: number, context: Context) {
    this.stopping.add(botId);
    try {
      void this.execution.stop(botId);
      const tasks = await this.harness.commit(
        (tx) => stopEngine(tx, botId as ConversationId),
        context,
      );
      for (const id of tasks.reverse())
        void this.harness.abortTask(id, context).catch(() => {});
    } finally {
      this.stopping.delete(botId);
    }
  }

  async prepare(botId: number, context: Context, refresh = false) {
    const profile = await this.profile(botId, context);
    const computerId = await this.execution.computers.computerId(
      botId,
      context,
    );
    const result = await this.connections.inspect(
      botId,
      profile.config,
      context,
      refresh,
    );
    if (
      computerId !== (await this.execution.computers.computerId(botId, context))
    )
      throw new WorkError("CONFLICT", "工作电脑已更换。请重新检查连接。");
    await this.harness.commit(async (tx) => {
      const doc = await tx.doc(EngineDoc, botId as ConversationId);
      if (doc.revision !== profile.revision)
        throw new WorkError("CONFLICT", "配置已更新。请重新检查连接。");
      doc.prepared = result.authenticated;
      doc.preparedComputerId = computerId;
      if ("controls" in result && result.controls?.skills) {
        doc.runtime ??= {};
        doc.runtime.nativeSkills = result.controls.skills;
      }
    }, context);
    return result;
  }

  async answer(
    botId: number,
    id: string,
    answer: EngineAnswer,
    context: Context,
  ) {
    await this.execution.answer(botId, id, answer, context);
  }

  takeRequest(botId: number, id: string, view: string, context: Context) {
    return this.execution.takeRequest(botId, id, view, context);
  }
}

export { EngineExecution } from "../harness/execution.ts";
export { engineTask } from "../harness/task.ts";

export function engineCatalog() {
  return [...providers.values()].map(({ id, name, capabilities }) => ({
    id,
    name,
    capabilities,
  }));
}
