import type { Context } from "@earendil-works/chord/context";
import { defineTask, type EntryId } from "@earendil-works/pi-durable";
import { finishCompactions, projectContext } from "./context.ts";
import type { EngineExecution } from "./execution.ts";
import { EngineProjection } from "./projection.ts";
import { reconcileEngine } from "./reconcile.ts";
import { EngineDoc, EngineInputDoc, EngineMessage } from "./state.ts";
import {
  type EngineCheckpoint,
  type EngineRuntime,
  type EngineTaskInput,
  stored,
} from "./task-types.ts";
import { finishUsage } from "./usage.ts";

export function engineTask(execution: EngineExecution) {
  return defineTask<EngineTaskInput, EngineCheckpoint, null, object>({
    name: "domos.engine-turn",
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: {
      async run(task, runtime, context) {
        if (task.input.previous)
          await runtime.waitForTask(task.input.previous, context);
        let delivered = false;
        await runtime.commit(async (tx) => {
          const doc = await reconcileEngine(tx, runtime.conversationId);
          const input = await tx.doc(EngineInputDoc, task.id);
          if (input.status !== "settled") return;
          doc.tasks = doc.tasks.filter((id) => id !== task.id);
          doc.taskId = doc.tasks.at(-1) ?? null;
          delivered = true;
        }, context);
        if (delivered) {
          await runtime.commit(
            () => ({
              status: "terminal" as const,
              outcome: { status: "completed" as const, result: null },
            }),
            context,
          );
          return;
        }
        await runtime.commit(async (tx) => {
          const doc = await tx.doc(EngineDoc, runtime.conversationId);
          if (doc.activeId !== task.id) {
            doc.activeId = task.id;
            doc.activeTurn = task.input.turnId;
            doc.dispatch = "ready";
            doc.turnId = null;
            doc.drafts = [];
            doc.error = null;
            if (doc.runtime) {
              doc.runtime.processing = false;
              doc.runtime.notices = {};
              delete doc.runtime.editorText;
            }
          }
          doc.approvals = [];
        }, context);
        const state = await runtime.snapshot(
          EngineDoc,
          runtime.conversationId,
          context,
        );
        const projection = new EngineProjection(
          runtime,
          task.input.turnId,
          context,
          state?.drafts ?? [],
        );
        let error: string | null = null;
        try {
          await execution.run(
            runtime,
            task.input.text,
            context,
            (event) => projection.emit(event),
            task.input.attachments,
            task.input.operation,
          );
          await projection.flush();
        } catch (cause) {
          if (runtime.signal.aborted) throw cause;
          error =
            cause instanceof Error
              ? cause.message
              : "任务未完成。请检查工作电脑和账号。";
          await projection.flush();
        }
        await finish(runtime, context, error);
      },
    },
    async abort(_task, runtime, context) {
      await finish(runtime, context, "工作已停止。", "aborted");
    },
  });
}

async function finish(
  runtime: EngineRuntime,
  context: Context,
  error: string | null,
  reason = error,
) {
  await runtime.commit(async (tx, current) => {
    const doc = await tx.doc(EngineDoc, runtime.conversationId);
    const additional = [];
    for (const id of doc.tasks) {
      if (id === runtime.taskId) continue;
      const task = await tx.task(id);
      if (!task || task.state.status === "terminal") continue;
      const delivery = await tx.doc(EngineInputDoc, id);
      if (delivery.owner !== runtime.taskId || delivery.status === "settled")
        continue;
      additional.push({ id, delivery, input: task.input as EngineTaskInput });
    }
    if (
      current.input.operation &&
      doc.runtime?.compactionDetails?.taskId !== String(runtime.taskId)
    )
      await projectContext(tx, doc, runtime, {
        type: "compaction",
        status: "failed",
        trigger: "manual",
        error: error ?? "压缩未启动。",
      });
    if (doc.runtime?.compaction === "running")
      await projectContext(tx, doc, runtime, {
        type: "compaction",
        status: "uncertain",
        error: error ?? "引擎未确认压缩结果。",
      });
    await finishCompactions(tx, runtime);
    await finishUsage(tx, runtime, doc.config.provider, doc.sessionId);
    let answer: EntryId | undefined;
    if (doc.activeId === runtime.taskId) {
      for (const draft of doc.drafts) {
        if (error && draft.pending !== false) draft.stopped = true;
        if (!error) draft.pending = false;
        const entry = await tx.appendEntry(runtime.conversationId, {
          kind: EngineMessage,
          data: stored(draft),
        });
        if (
          draft.role === "assistant" &&
          !draft.stopped &&
          draft.content.some((part) => part.type === "text" && part.text)
        )
          answer = entry.id;
      }
      doc.drafts = [];
      doc.approvals = [];
      if (doc.runtime) doc.runtime.processing = false;
      doc.activeId = null;
      doc.activeTurn = null;
      doc.error = reason === "aborted" ? null : error;
      if (!error) {
        doc.prepared = true;
        doc.preparedComputerId = doc.computerId;
      }
    }
    if (error && !current.input.operation)
      await tx.appendEntry(runtime.conversationId, {
        kind: EngineMessage,
        data: stored({
          id: `${runtime.taskId}:terminal`,
          turnId: current.input.turnId,
          role: "assistant",
          content: [],
          stopped: reason === "aborted",
          stopReason: reason === "aborted" ? "aborted" : "error",
          timestamp: Date.now(),
          ...(reason === "aborted" ? {} : { error }),
        }),
      });
    if (current.input.operation) {
      answer = (
        await tx.appendEntry(runtime.conversationId, {
          kind: "domos.engine-operation",
          data: {
            operation: current.input.operation,
            status: doc.runtime?.compaction ?? (error ? "failed" : "completed"),
            ...(doc.runtime?.compactionDetails ?? {}),
          },
        })
      ).id;
    }
    if (!answer && !error)
      answer = (
        await tx.appendEntry(runtime.conversationId, {
          kind: EngineMessage,
          data: stored({
            id: `${runtime.taskId}:done`,
            turnId: current.input.turnId,
            role: "assistant",
            content: [{ type: "text", text: "任务已完成。", key: "done" }],
            stopped: false,
            timestamp: Date.now(),
          }),
        })
      ).id;
    tx.settleSubmission(
      current.input.submissionId,
      error || !answer
        ? { status: "unanswered", reason: reason ?? "执行结果未确认。" }
        : { status: "done", answer },
    );
    for (const { id, delivery, input } of additional) {
      const confirmed = delivery.status === "accepted";
      tx.settleSubmission(
        input.submissionId,
        confirmed && answer && !error
          ? { status: "done", answer }
          : {
              status: "unanswered",
              reason: confirmed
                ? (reason ?? "执行结果未确认。")
                : "追加消息的接收结果未确认。请核对回复后再发送。",
            },
      );
      if (!confirmed && reason !== "aborted")
        await tx.appendEntry(runtime.conversationId, {
          kind: EngineMessage,
          data: stored({
            id: `${id}:terminal`,
            turnId: input.turnId,
            role: "assistant",
            content: [],
            stopped: false,
            stopReason: "error",
            timestamp: Date.now(),
            error: "追加消息的接收结果未确认。请核对回复后再发送。",
          }),
        });
      delivery.status = "settled";
    }
    doc.tasks = doc.tasks.filter((id) => id !== runtime.taskId);
    doc.taskId = doc.tasks.at(-1) ?? null;
    return {
      status: "terminal",
      outcome: { status: "completed", result: null },
    };
  }, context);
}
