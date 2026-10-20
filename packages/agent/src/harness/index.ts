import type { Context } from "@earendil-works/chord/context";
import {
  AgentDoc,
  type ConversationId,
  configure,
  type Harness,
  LiveDoc,
} from "@earendil-works/pi-durable";
import { chatView } from "../chat-view.ts";
import { watchCommits } from "../watch.ts";
import { WorkError } from "../work/state.ts";
import { EngineConnections } from "./connections.ts";
import type { EngineExecution } from "./execution.ts";
import { engineProvider, providers } from "./providers/index.ts";
import { EngineDoc, EngineInputDoc, EngineMessage } from "./state.ts";
import { engineTask } from "./task.ts";
import { userMessage } from "./task-types.ts";
import type { EngineAnswer, EngineConfig, EngineInput } from "./types.ts";

export class Engines {
  private readonly stopping = new Set<number>();
  private readonly harness: Harness;
  readonly execution: EngineExecution;
  readonly task;
  readonly connections;
  constructor(harness: Harness, execution: EngineExecution) {
    this.harness = harness;
    this.execution = execution;
    this.task = engineTask(execution);
    this.connections = new EngineConnections(execution);
  }

  async profile(botId: number, context: Context) {
    const id = botId as ConversationId;
    const [doc, agent] = await Promise.all([
      this.harness.snapshot(EngineDoc, id, context),
      this.harness.snapshot(AgentDoc, id, context),
    ]);
    return {
      config: doc?.config ?? {
        provider: "pi" as const,
        model: agent?.model
          ? `${agent.model.provider}/${agent.model.modelId}`
          : null,
      },
      revision: doc?.revision ?? 0,
      busy: Boolean(doc?.tasks.length),
      error: doc?.error ?? null,
      prepared: Boolean(
        doc?.prepared &&
          (doc.preparedComputerId ?? doc.computerId) ===
            (await this.execution.computers.computerId(botId, context)),
      ),
      providers: [...providers.values()].map(({ id, name, capabilities }) => ({
        id,
        name,
        capabilities,
      })),
    };
  }

  async view(botId: number, context: Context) {
    const conversation = await this.harness.conversation(
      botId as ConversationId,
      context,
    );
    if (!conversation) throw new WorkError("NOT_FOUND", "Bot 不存在。");
    const state = await conversation.viewState(context);
    try {
      const engine = await this.harness.snapshot(
        EngineDoc,
        botId as ConversationId,
        context,
      );
      return chatView(state.value, engine);
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

  async configure(
    botId: number,
    input: { config: EngineConfig; revision: number; requestId: string },
    context: Context,
  ) {
    engineProvider(input.config.provider);
    if (this.connections.busy(botId))
      throw new WorkError("CONFLICT", "请先完成账号连接。");
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
      doc.config = input.config;
      doc.revision++;
      doc.requestId = input.requestId;
      if (input.config.provider === "pi" && input.config.model) {
        const separator = input.config.model.indexOf("/");
        if (separator < 1)
          throw new WorkError("BAD_REQUEST", "请选择 Pi 的模型。");
        await configure(tx, botId as ConversationId, {
          model: {
            provider: input.config.model.slice(0, separator),
            modelId: input.config.model.slice(separator + 1),
          },
        });
      }
      doc.sessionId = null;
      doc.turnId = null;
      doc.dispatch = "ready";
      doc.error = null;
      doc.prepared = false;
      doc.prompt = null;
    }, context);
    return this.profile(botId, context);
  }

  async submit(botId: number, input: EngineInput, context: Context) {
    const id = botId as ConversationId;
    if (this.connections.busy(botId))
      throw new WorkError("CONFLICT", "请先完成账号连接。");
    await this.execution.computers.preflight(botId, context);
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
      const doc = await tx.doc(EngineDoc, id);
      if (
        (await tx.doc(LiveDoc, id)).run ||
        (doc.tasks.length && input.whenBusy === "reject")
      )
        throw new WorkError("CONFLICT", "Bot 正在工作。请稍后发送。");
      if (!doc.config.model && doc.config.provider === "pi") {
        const model = (await tx.doc(AgentDoc, id)).model;
        if (model) doc.config.model = `${model.provider}/${model.modelId}`;
      }
      if (doc.computerId !== computerId) {
        doc.computerId = computerId;
        doc.sessionId = null;
      }
      const submission = await tx.createSubmission({
        type: "input",
        conversationId: id,
        requestId: input.requestId,
        status: "queued",
      });
      const turnId = `engine:${submission.id}`;
      const entry = await tx.appendEntry(id, {
        kind: EngineMessage,
        data: userMessage(turnId, input.text, input.attachments),
      });
      tx.placeSubmission(submission.id, entry.id);
      const taskId = await tx.createTask(
        this.task,
        {
          text: [
            input.text,
            ...(input.attachments ?? []).map(
              (file) => `Uploaded file: ${file.path}`,
            ),
          ].join("\n\n"),
          submissionId: submission.id,
          previous: doc.taskId,
          turnId,
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

  async stop(botId: number, context: Context) {
    this.stopping.add(botId);
    try {
      const stopped = this.execution.stop(botId);
      const doc = await this.harness.snapshot(
        EngineDoc,
        botId as ConversationId,
        context,
      );
      await Promise.all(
        [...(doc?.tasks ?? [])]
          .reverse()
          .map((id) => this.harness.abortTask(id, context)),
      );
      await stopped;
    } finally {
      this.stopping.delete(botId);
    }
  }

  async prepare(botId: number, context: Context) {
    const profile = await this.profile(botId, context);
    const computerId = await this.execution.computers.computerId(
      botId,
      context,
    );
    const result = await this.connections.inspect(
      botId,
      profile.config,
      context,
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
    }, context);
    return result;
  }

  async answer(
    botId: number,
    id: string,
    answer: EngineAnswer,
    context: Context,
  ) {
    const doc = await this.harness.snapshot(
      EngineDoc,
      botId as ConversationId,
      context,
    );
    if (!doc?.approvals.some((approval) => approval.id === id))
      throw new WorkError("CONFLICT", "这次确认已经失效。");
    await this.execution.answer(botId, id, answer);
    await this.harness.commit(async (tx) => {
      const state = await tx.doc(EngineDoc, botId as ConversationId);
      state.approvals = state.approvals.filter(
        (approval) => approval.id !== id,
      );
    }, context);
  }
}

export { EngineExecution } from "./execution.ts";
export { engineTask } from "./task.ts";
export { engineIds } from "./types.ts";
export function engineCatalog() {
  return [...providers.values()].map(({ id, name, capabilities }) => ({
    id,
    name,
    capabilities,
  }));
}
