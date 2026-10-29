import type { Context } from "@earendil-works/chord/context";
import { defineTask, type EntryId } from "@earendil-works/pi-durable";
import { MemoryReviewDoc } from "../work/memory.ts";
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
import { finishUsage, UsageTaskDoc } from "./usage.ts";

export function engineTask(execution: EngineExecution) {
  const taskDefinition: ReturnType<
    typeof defineTask<EngineTaskInput, EngineCheckpoint, null, object>
  > = defineTask<EngineTaskInput, EngineCheckpoint, null, object>({
    name: "domos.engine-turn",
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: {
      async run(task, runtime, context) {
        if (task.input.previous)
          await runtime.waitForTask(task.input.previous, context);
        if (task.input.memoryReview) {
          let completed = false;
          let enabled = false;
          await runtime.commit(async (tx) => {
            const review = await tx.doc(
              MemoryReviewDoc,
              runtime.conversationId,
            );
            const doc = await tx.doc(EngineDoc, runtime.conversationId);
            enabled = review.enabled && doc.tasks.every((id) => id === task.id);
            review.reviewing = enabled;
          }, context);
          try {
            if (enabled)
              await execution.run(
                runtime,
                task.input.text,
                context,
                async (event) => {
                  if (event.type !== "usage") return;
                  await runtime.commit(async (tx) => {
                    (await tx.doc(UsageTaskDoc, runtime.taskId)).items[
                      event.usage.id
                    ] = event.usage;
                  }, context);
                },
                [],
                undefined,
                true,
              );
            completed = enabled;
          } finally {
            await runtime.commit(async (tx) => {
              const doc = await tx.doc(EngineDoc, runtime.conversationId);
              const review = await tx.doc(
                MemoryReviewDoc,
                runtime.conversationId,
              );
              review.reviewing = false;
              if (completed) {
                review.through = task.input.reviewThrough ?? review.through;
                review.turns = Math.max(0, review.turns - 10);
              }
              await finishUsage(tx, runtime, doc.config.provider, null);
              doc.tasks = doc.tasks.filter((id) => id !== runtime.taskId);
              doc.taskId = doc.tasks.at(-1) ?? null;
            }, context);
          }
          await runtime.commit(
            () => ({
              status: "terminal",
              outcome: { status: "completed", result: null },
            }),
            context,
          );
          return;
        }
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
          (await tx.doc(MemoryReviewDoc, runtime.conversationId)).reviewing =
            false;
          if (doc.activeId !== task.id) {
            doc.activeId = task.id;
            doc.activeTurn = task.input.turnId;
            doc.run = {
              turnId: task.input.turnId,
              provider: doc.config.provider,
              model: doc.config.model,
              startedAt: Date.now(),
              status: "running",
            };
            doc.dispatch = "ready";
            doc.turnId = null;
            doc.drafts = [];
            doc.error = null;
            if (doc.runtime) {
              doc.runtime.processing = false;
              doc.runtime.notices = {};
              delete doc.runtime.retry;
              delete doc.runtime.editorText;
            }
          }
          for (const draft of doc.drafts)
            if (draft.takeover?.state === "waiting")
              draft.takeover.state = "expired";
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
        await finish(runtime, context, error, undefined, taskDefinition);
      },
    },
    async abort(_task, runtime, context) {
      if (_task.input.memoryReview) {
        await runtime.commit(async (tx) => {
          const doc = await tx.doc(EngineDoc, runtime.conversationId);
          (await tx.doc(MemoryReviewDoc, runtime.conversationId)).reviewing =
            false;
          await finishUsage(tx, runtime, doc.config.provider, null);
          doc.tasks = doc.tasks.filter((id) => id !== runtime.taskId);
          doc.taskId = doc.tasks.at(-1) ?? null;
        }, context);
        return;
      }
      await finish(runtime, context, "工作已停止。", "aborted", taskDefinition);
    },
  });
  return taskDefinition;
}

async function finish(
  runtime: EngineRuntime,
  context: Context,
  error: string | null,
  reason = error,
  taskDefinition: ReturnType<
    typeof defineTask<EngineTaskInput, EngineCheckpoint, null, object>
  >,
) {
  await runtime.commit(async (tx, current) => {
    const doc = await tx.doc(EngineDoc, runtime.conversationId);
    if (!doc.tasks.includes(runtime.taskId)) {
      await finishCompactions(tx, runtime);
      await finishUsage(tx, runtime, doc.config.provider, null);
      return {
        status: "terminal",
        outcome: { status: "completed", result: null },
      };
    }
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
      if (doc.run) {
        doc.run.endedAt = Date.now();
        doc.run.status =
          reason === "aborted" ? "stopped" : error ? "failed" : "ended";
        await tx.appendEntry(runtime.conversationId, {
          kind: "domos.engine-run",
          data: stored(doc.run),
        });
      }
      for (const draft of doc.drafts) {
        if (draft.takeover?.state === "waiting")
          draft.takeover.state = "expired";
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
      if (doc.runtime) {
        doc.runtime.processing = false;
        delete doc.runtime.retry;
      }
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
          ...(reason === "aborted"
            ? {}
            : { error: `${error}〔${runtime.taskId}:0〕` }),
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
    if (!error && doc.sessionKey && doc.sessionId && answer) {
      doc.sessions ??= {};
      doc.sessions[doc.sessionKey] = { id: doc.sessionId, through: answer };
    }
    if (current.input.submissionId)
      tx.settleSubmission(
        current.input.submissionId,
        error || !answer
          ? { status: "unanswered", reason: reason ?? "执行结果未确认。" }
          : { status: "done", answer },
      );
    for (const { id, delivery, input } of additional) {
      const confirmed = delivery.status === "accepted";
      if (input.submissionId)
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
    if (
      !error &&
      !current.input.operation &&
      current.input.submissionId &&
      current.input.source !== "routine"
    ) {
      const memoryReview = await tx.doc(
        MemoryReviewDoc,
        runtime.conversationId,
      );
      if (memoryReview.enabled) memoryReview.turns++;
      if (
        memoryReview.enabled &&
        memoryReview.turns >= 10 &&
        doc.tasks.length === 0
      ) {
        const id = await tx.createTask(
          taskDefinition,
          {
            text: "Review the recent conversation and save useful durable memories.",
            previous: runtime.taskId,
            turnId: `memory-review:${runtime.taskId}`,
            memoryReview: true,
            reviewThrough: answer,
          },
          {
            ownership: { kind: "conversation" },
            conversationId: runtime.conversationId,
            background: true,
          },
        );
        doc.tasks.push(id);
        doc.taskId = id;
      }
    }
    return {
      status: "terminal",
      outcome: { status: "completed", result: null },
    };
  }, context);
}
