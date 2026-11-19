import type { Context } from "@earendil-works/chord/context";
import {
  AgentDoc,
  type ConversationId,
  type Cursor,
  configure,
  type EntryId,
  type EntryRecord,
  type Harness,
  LiveDoc,
} from "@earendil-works/pi-durable";
import { attachmentInstructions } from "../attachments.ts";
import { type ChatPage, chatView } from "../chat-view.ts";
import { DelegationsDoc } from "../collaboration.ts";
import {
  ComputerRequests,
  type ComputerRuntime,
  ordinaryQuestion,
  QuestionDoc,
} from "../computer/runtime.ts";
import { ComputersDoc } from "../computer/state.ts";
import { BotSession, BotSessions, owningBot } from "../conversations.ts";
import { EngineConnections } from "../harness/connections.ts";
import type { EngineExecution } from "../harness/execution.ts";
import { completeCredentials } from "../harness/interactions.ts";
import { EngineModelCatalog } from "../harness/model-catalog.ts";
import { engineProvider, providers } from "../harness/providers/index.ts";
import {
  questionChoices,
  validateQuestionAnswer,
} from "../harness/questions.ts";
import {
  readEngine,
  reconcileEngine,
  stopEngine,
} from "../harness/reconcile.ts";
import { switchSession } from "../harness/sessions.ts";
import { EngineDoc, EngineInputDoc, EngineMessage } from "../harness/state.ts";
import { engineTask } from "../harness/task.ts";
import {
  type EngineTaskInput,
  stored,
  userMessage,
} from "../harness/task-types.ts";
import type {
  EngineAnswer,
  EngineConfig,
  EngineInput,
} from "../harness/types.ts";
import { supportedApprovalModes } from "../harness/types.ts";
import {
  type UsageDimension,
  type UsageFilter,
  type UsageMetric,
  UsageReader,
} from "../harness/usage.ts";
import { materialText } from "../materials.ts";
import { approvalMessage } from "../messages.ts";
import { TeamsDoc } from "../teams.ts";
import { watchCommits } from "../watch.ts";
import { applyRoutineDelivery } from "../work/routine-delivery.ts";
import { RoutinesDoc } from "../work/routine-state.ts";
import { WorkError } from "../work/state.ts";
import { MaintenanceDoc } from "./maintenance.ts";

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

async function questionMessage(
  harness: Harness,
  botId: number,
  message: import("../messages.ts").ChatMessage,
  context: Context,
) {
  if (!message.approval || !ordinaryQuestion(message.approval.request))
    return message;
  const saved = await harness.snapshot(
    QuestionDoc,
    botId as ConversationId,
    message.approval.request.id,
    context,
  );
  return saved?.request
    ? {
        ...message,
        ...approvalMessage(
          saved.request,
          saved.answer
            ? saved.answer.allow
              ? "answered"
              : "denied"
            : "pending",
          saved.answer,
        ),
        cursor: saved.cursor ?? message.cursor,
      }
    : message;
}

export class Runtime {
  collaboration?: import("../collaboration.ts").Collaboration;
  private readonly stopping = new Set<number>();
  private readonly usageReader: UsageReader;
  private readonly harness: Harness;
  readonly execution: EngineExecution;
  readonly task;
  readonly connections;
  constructor(
    harness: Harness,
    execution: EngineExecution,
    database = ":memory:",
  ) {
    this.harness = harness;
    this.execution = execution;
    this.task = engineTask(execution);
    this.connections = new EngineConnections(
      execution,
      new EngineModelCatalog(harness),
    );
    this.usageReader = new UsageReader(harness, database);
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
      approvalModes: supportedApprovalModes(config.provider),
      automaticApproval:
        !config.approvalMode &&
        (await this.harness.snapshot(ComputersDoc, context))?.bindings[
          String(botId)
        ]?.approvalMode === "auto",
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
      providers: engineCatalog(),
    };
  }

  usage(botIds: number[], filter: UsageFilter, context: Context) {
    return this.usageReader.read(botIds, filter, context);
  }

  usageSummary(
    botIds: number[],
    filter: UsageFilter,
    dimension: UsageDimension,
    metric: UsageMetric,
    limit: number,
    context: Context,
  ) {
    return this.usageReader.summary(
      botIds,
      filter,
      dimension,
      metric,
      limit,
      context,
    );
  }

  async view(
    botId: number,
    context: Context,
    page?: ChatPage & { limit: number },
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
    const position = page?.around ?? page?.after ?? page?.before;
    const [entryId = 0, messageIndex = 0] =
      position?.split(":").map(Number) ?? [];
    let cursor: Cursor | undefined;
    let newer: Cursor | undefined;
    if (page?.around) {
      const [before, after] = await Promise.all([
        conversation.entries(
          { order: "descending", maxEntryId: entryId as EntryId },
          page.limit + 1,
          undefined,
          context,
        ),
        conversation.entries(
          { order: "ascending", minEntryId: entryId as EntryId },
          page.limit + 1,
          undefined,
          context,
        ),
      ]);
      entries.push(
        ...new Map(
          [...before.items, ...after.items].map((entry) => [entry.id, entry]),
        ).values(),
      );
      entries.sort((a, b) => a.id - b.id);
      cursor = before.next;
      newer = after.next;
    } else
      do {
        const batch = await conversation.entries(
          {
            order: !page || page.after ? "ascending" : "descending",
            ...(page?.before ? { maxEntryId: entryId as EntryId } : {}),
            ...(page?.after ? { minEntryId: entryId as EntryId } : {}),
          },
          page ? page.limit + (page.after ? 1 : 0) : 500,
          cursor,
          context,
        );
        entries.push(...batch.items);
        cursor = batch.next;
      } while (!page && cursor);
    if (page && !page.around && !page.after) entries.reverse();
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
    view.messages = await Promise.all(
      view.messages.map((message) =>
        questionMessage(this.harness, botId, message, context),
      ),
    );
    if (page) {
      const relative = (message: import("../messages.ts").ChatMessage) => {
        const [entry = 0, index = 0] =
          message.cursor?.split(":").map(Number) ?? [];
        return entry - entryId || index - messageIndex;
      };
      const messages = view.messages.filter(
        (message) => !position || message.cursor,
      );
      if (page.around) {
        const older = messages.filter((message) => relative(message) < 0);
        const later = messages.filter((message) => relative(message) >= 0);
        const half = Math.floor(page.limit / 2);
        view.messages = [
          ...older.slice(-half),
          ...later.slice(0, page.limit - half),
        ];
        if (cursor || older.length > half)
          view.before = view.messages[0]?.cursor;
        if (newer || later.length > page.limit - half)
          view.after = view.messages.at(-1)?.cursor;
      } else if (page.after) {
        const later = messages.filter((message) => relative(message) > 0);
        view.messages = later.slice(0, page.limit);
        if (cursor || later.length > page.limit)
          view.after =
            view.messages.at(-1)?.cursor ?? `${entries.at(-1)?.id}:0`;
      } else {
        const older = messages.filter(
          (message) => !position || relative(message) < 0,
        );
        view.messages = older.slice(-page.limit);
        if (cursor || older.length > page.limit)
          view.before = view.messages[0]?.cursor ?? `${entries[0]?.id}:0`;
      }
    }
    const saved = new Set(view.messages.map((message) => message.id));
    view.messages.push(
      ...(!position ? (engine?.drafts ?? []) : []).filter(
        (message) => !saved.has(message.id),
      ),
    );
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
    view.delegations = await this.collaboration?.status(
      botId as ConversationId,
      undefined,
      context,
    );
    const delegations =
      (await this.harness.snapshot(DelegationsDoc, context))?.items ?? [];
    const sessions = new Map([
      [
        botId as ConversationId,
        await owningBot(this.harness, botId as ConversationId, context),
      ],
    ]);
    for (const [session] of sessions) {
      for (const item of delegations) {
        if (item.source === session && !item.cancelled && !item.endedAt)
          sessions.set(item.session, item.recipient as ConversationId);
      }
    }
    const executions = await Promise.all(
      [...sessions].map(async ([sessionId, owner]) => {
        const [state, approvals] =
          sessionId === botId
            ? [engine, requests]
            : await Promise.all([
                readEngine(this.harness, sessionId, context),
                this.harness.snapshot(ComputerRequests, sessionId, context),
              ]);
        const activeTurnId = state?.activeTurn ?? null;
        const queued =
          !activeTurnId && state?.tasks.length
            ? await this.harness.commit(async (tx) => {
                for (const id of state.tasks) {
                  const task = await tx.task(id);
                  if (!task || task.state.status === "terminal") continue;
                  const input = task.input as EngineTaskInput;
                  if (input.memoryReview) continue;
                  const previous = input.previous
                    ? await tx.task(input.previous)
                    : null;
                  return {
                    turnId: input.turnId,
                    waiting:
                      previous && previous.state.status !== "terminal"
                        ? previous.conversationId !== sessionId
                          ? "正在处理另一项任务，完成后继续。"
                          : "排队中，等待前一项任务完成。"
                        : "等待执行。",
                  };
                }
              }, context)
            : undefined;
        let waiting = queued?.waiting;
        if (activeTurnId && approvals?.approvals.length) {
          waiting = approvals.approvals.some((item) => item.takeover)
            ? "等待你完成接管。"
            : approvals.approvals.some((item) => item.kind === "question")
              ? "等待你的回答。"
              : "等待你的确认。";
        }
        return {
          activeTurnId,
          activity: {
            botId: owner,
            sessionId,
            executionId: activeTurnId ?? queued?.turnId,
            processing: Boolean(
              activeTurnId && state?.run?.status !== "stopping" && !waiting,
            ),
            retry: activeTurnId ? state?.runtime?.retry : undefined,
            waiting,
          },
        };
      }),
    );
    const own = executions.find(({ activity }) => activity.sessionId === botId);
    view.activity = executions.map(({ activity }) => activity);
    view.activeTurnId = own?.activeTurnId ?? view.activeTurnId;
    view.processing = own?.activity.processing ?? false;
    view.busy ||= Boolean(
      view.activity.some((item) => item.executionId) ||
        view.delegations?.some(
          (item) => item.status === "running" || item.status === "queued",
        ),
    );
    view.failed ||= Boolean(engine?.error);
    applyRoutineDelivery(
      view,
      (await this.harness.snapshot(RoutinesDoc, context))?.runs.filter(
        (run) => run.botId === botId,
      ) ?? [],
    );
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
    const message = chatView({
      conversation,
      entries: batch.items,
      docs: {},
    }).messages.find((message) => message.id === id);
    return message
      ? questionMessage(this.harness, botId, message, context)
      : null;
  }

  watch(botId: number, context: Context, page?: { limit: number }) {
    let sessions = new Set([botId]);
    return watchCommits(
      this.harness,
      (change) =>
        (change.type === "entry" && change.value.conversationId === botId) ||
        (change.type === "task" &&
          change.value.conversationId === botId &&
          change.value.state.status === "terminal") ||
        ((change.type === "document" || change.type === "document.copy") &&
          (sessions.has(change.conversationId as number) ||
            change.record.kind === DelegationsDoc.definition.kind)),
      async () => {
        const view = await this.view(botId, context, page);
        sessions = new Set(
          view.activity?.map((item) => item.sessionId) ?? [botId],
        );
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
        notices: {
          ...current.runtime?.notices,
          skills: "",
          ...controls.notices,
        },
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
    const modes = supportedApprovalModes(input.config.provider);
    const requested =
      input.config.approvalMode ?? previous?.config.approvalMode ?? "ask";
    const unsupported = !modes.includes(requested);
    if (unsupported && previous?.config.provider === input.config.provider)
      throw new WorkError("BAD_REQUEST", "此 Harness 不支持所选权限模式。");
    const config: EngineConfig = {
      ...input.config,
      ...(input.config.approvalMode || previous?.config.approvalMode
        ? { approvalMode: unsupported ? "ask" : requested }
        : {}),
    };
    if (config.approvalMode && config.options) {
      config.options = { ...config.options };
      if (config.provider === "codex") delete config.options.approvalPolicy;
      if (config.provider === "claude") delete config.options.permissionMode;
      if (!Object.keys(config.options).length) delete config.options;
    }
    input = { ...input, config };
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
      for (const session of (await tx.doc(BotSessions)).items.filter(
        (item) => item.botId === botId,
      ))
        if ((await tx.doc(EngineDoc, session.id)).tasks.length)
          throw new WorkError("CONFLICT", "请先停止 Bot 的工作。");
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
      const notice = unsupported
        ? "此运行方式不支持原权限模式，已改为按需询问。"
        : undefined;
      if (!reset) {
        if (doc.runtime) {
          doc.runtime.controls = undefined;
          doc.runtime.notices = {
            ...doc.runtime.notices,
            permissions: notice ?? "",
          };
        }
        return;
      }
      doc.runtime = { notices: { permissions: notice ?? "" } };
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
    await this.execution.closeIdle(botId);
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
    if ((await this.harness.snapshot(MaintenanceDoc, context))?.held)
      throw new WorkError("CONFLICT", "正在更新后台。请稍后再试。");
    const id = botId as ConversationId;
    const ownerId = await owningBot(this.harness, id, context);
    if (ownerId !== id) {
      await this.harness.commit(async (tx) => {
        const doc = await tx.doc(EngineDoc, id);
        if (doc.tasks.length) return;
        const config = stored((await tx.doc(EngineDoc, ownerId)).config);
        if (JSON.stringify(config) !== JSON.stringify(doc.config)) {
          switchSession(doc, config, doc.computerId);
          doc.config = config;
        }
        const agent = await tx.doc(AgentDoc, ownerId);
        await configure(tx, id, {
          model: agent.model,
          instructions: agent.instructions,
        });
      }, context);
    }
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
    let waiting: ReturnType<ComputerRuntime["questionWaiting"]>;
    const admission = this.harness.commit(async (tx) => {
      if ((await tx.doc(MaintenanceDoc)).held)
        throw new WorkError("CONFLICT", "正在更新后台。请稍后再试。");
      const existing = await tx.submissionByRequest(id, input.requestId);
      if (existing) return existing.id;
      const question = input.questionAnswer
        ? await tx.doc(QuestionDoc, id, input.questionAnswer.id, null)
        : undefined;
      if (question && input.questionAnswer) {
        if (!question.request) throw new WorkError("NOT_FOUND", "问题不存在。");
        if (question.answer) throw new WorkError("CONFLICT", "问题已经回答。");
        validateQuestionAnswer(question.request, input.questionAnswer.answer);
      }
      const teamId = (await tx.doc(BotSession, id)).teamId;
      if (
        teamId &&
        !(await tx.doc(TeamsDoc)).items.some(
          (team) => team.id === teamId && team.members.includes(ownerId),
        )
      )
        throw new WorkError("CONFLICT", "Bot 已离开此团队。");
      if (
        input.delegationId &&
        (await tx.doc(DelegationsDoc)).items.find(
          (item) => item.id === input.delegationId,
        )?.cancelled
      )
        throw new WorkError("CONFLICT", "协作任务已取消。");
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
      const sessions = (await tx.doc(BotSessions)).items
        .filter((item) => item.botId === ownerId)
        .map((item) => item.id);
      const pending = (
        await Promise.all(
          [...new Set([ownerId, ...sessions])].map((session) =>
            tx.doc(EngineDoc, session),
          ),
        )
      ).flatMap((doc) => doc.tasks);
      const previous =
        pending.sort((a, b) => Number(a) - Number(b)).at(-1) ?? null;
      const submission = await tx.createSubmission({
        type: "input",
        conversationId: id,
        requestId: input.requestId,
        status: "queued",
      });
      const turnId = `engine:${submission.id}`;
      const routine = input.routineRunId
        ? (await tx.doc(RoutinesDoc)).runs.find(
            (run) => run.id === input.routineRunId && run.botId === botId,
          )
        : undefined;
      const entry = await tx.appendEntry(id, {
        kind: input.operation ? "domos.engine-operation" : EngineMessage,
        data: input.operation
          ? { operation: input.operation }
          : {
              ...userMessage(
                turnId,
                input.displayText ?? input.text,
                input.attachments,
                input.requestId,
                input.materials,
              ),
              ...(question?.request
                ? {
                    reply: {
                      id: approvalMessage(question.request, "pending").id,
                      title:
                        question.request.questions?.[0]?.title ??
                        question.request.title,
                      cursor: question.cursor,
                      attachments: approvalMessage(question.request, "pending")
                        .attachments?.filter((file) =>
                          file.mimeType?.startsWith("image/"),
                        )
                        .slice(0, 1),
                    },
                  }
                : {}),
              ...(input.author
                ? { role: "assistant", author: input.author }
                : {}),
              ...(routine
                ? {
                    routine: {
                      runId: routine.id,
                      title: routine.title,
                      scheduledAt: routine.scheduledAt,
                    },
                  }
                : {}),
            },
      });
      tx.placeSubmission(submission.id, entry.id);
      if (question && input.questionAnswer) {
        question.answer = JSON.parse(
          JSON.stringify(input.questionAnswer.answer),
        );
        waiting = this.execution.computer.questionWaiting(
          botId,
          input.questionAnswer.id,
        );
        if (waiting) {
          waiting.completing = true;
          if (!doc.activeId) {
            tx.settleSubmission(submission.id, {
              status: "done",
              answer: entry.id,
            });
            return submission.id;
          }
        }
      }

      const taskId = await tx.createTask(
        this.task,
        {
          text: [
            input.displayText !== undefined
              ? input.text
              : materialText(input.text, input.materials),
            attachmentInstructions(input.attachments ?? [], ownerId),
          ]
            .filter(Boolean)
            .join("\n\n"),
          submissionId: submission.id,
          previous: waiting ? doc.activeId : previous,
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
          ownership: input.parent
            ? { kind: "task", taskId: input.parent }
            : { kind: "conversation" },
          conversationId: id,
          ...(input.parent ? {} : { background: true }),
        },
      );
      doc.taskId = taskId;
      doc.tasks.push(taskId);
      const delivery = await tx.doc(EngineInputDoc, taskId);
      if (waiting) {
        delivery.status = "accepted";
        delivery.owner = doc.activeId;
        if (doc.run)
          doc.run.inputTurns = [...(doc.run.inputTurns ?? []), turnId];
      } else if (input.whenBusy === "followUp") delivery.status = "deferred";
      return submission.id;
    }, context);
    const submissionId = await admission.catch((error) => {
      if (waiting) {
        waiting.completing = false;
        if (waiting.signal.aborted) waiting.expire();
      }
      throw error;
    });
    if (input.questionAnswer) waiting?.resolve(input.questionAnswer.answer);
    this.execution.deliver(botId);
    const submission = await this.harness.submission(submissionId, context);
    if (!submission) throw new Error("任务记录不存在。");
    return submission;
  }

  async maintenance(held: boolean | undefined, context: Context) {
    if (held === undefined)
      return (
        (await this.harness.snapshot(MaintenanceDoc, context))?.held ?? false
      );
    await this.harness.commit(async (tx) => {
      if (held) {
        for (const status of [
          "pending",
          "running",
          "waiting",
          "sleeping",
          "completing",
        ] as const) {
          const tasks = await tx.scanTasks(
            { kind: this.task.definition.name, status },
            1,
          );
          if (tasks.items.length)
            throw new WorkError(
              "CONFLICT",
              "Bot 仍有任务。请等待任务完成后再更新。",
            );
        }
      }
      (await tx.doc(MaintenanceDoc)).held = held;
    }, context);
    if (!held) this.harness.resume();
    return held;
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
      await this.collaboration?.stop(botId, context);
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
      if ("controls" in result && result.controls) {
        doc.runtime ??= {};
        doc.runtime.nativeSkills = result.controls.skills;
        doc.runtime.notices = {
          ...doc.runtime.notices,
          skills: "",
          ...result.controls.notices,
        };
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
    const question = await this.harness.snapshot(
      QuestionDoc,
      botId as ConversationId,
      id,
      context,
    );
    if (!question?.request)
      return this.execution.answer(botId, id, answer, context);
    const request = question.request;
    validateQuestionAnswer(request, answer);
    const text = answer.allow
      ? (
          request.questions ?? [
            { id: request.id, title: request.title, options: request.options },
          ]
        )
          .map((q) => {
            const choices = questionChoices(q);
            return (
              answer.answers?.[q.id] ??
              (answer.optionId
                ? [answer.optionId]
                : answer.text
                  ? [answer.text]
                  : [])
            )
              .map(
                (id) => choices.find((choice) => choice.id === id)?.label ?? id,
              )
              .join("、");
          })
          .join("\n")
      : "暂不回答";
    return this.submit(
      botId,
      {
        requestId: `question-answer:${id}`,
        text: `Reply to question [${id}]: ${request.questions?.[0]?.title ?? request.title}\n${text}`,
        displayText: text,
        whenBusy: "followUp",
        questionAnswer: { id, answer },
      },
      context,
    );
  }

  credentials(
    botId: number,
    id: string,
    values: Record<string, string>,
    context: Context,
  ) {
    return completeCredentials(this.execution, botId, id, values, context);
  }

  takeRequest(botId: number, id: string, view: string, context: Context) {
    return this.execution.takeRequest(botId, id, view, context);
  }
}

export { EngineExecution } from "../harness/execution.ts";
export { engineTask } from "../harness/task.ts";

export function engineCatalog() {
  return [...providers.values()].map(
    ({ id, name, capabilities, package: nativePackage, login }) => ({
      id,
      name,
      capabilities,
      installable: Boolean(nativePackage),
      login: Boolean(login) || id === "pi",
    }),
  );
}
