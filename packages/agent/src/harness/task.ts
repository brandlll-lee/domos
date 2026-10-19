import type { Context } from "@earendil-works/chord/context";
import { defineTask, type EntryId } from "@earendil-works/pi-durable";
import type { EngineExecution } from "./execution.ts";
import { EngineProjection } from "./projection.ts";
import { EngineDoc, EngineMessage } from "./state.ts";
import {
  type EngineCheckpoint,
  type EngineRuntime,
  type EngineTaskInput,
  stored,
} from "./task-types.ts";

export function engineTask(execution: EngineExecution) {
  return defineTask<EngineTaskInput, EngineCheckpoint, null, object>({
    name: "domos.engine-turn",
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: {
      async run(task, runtime, context) {
        if (task.input.previous)
          await runtime.waitForTask(task.input.previous, context);
        await runtime.commit(async (tx) => {
          const doc = await tx.doc(EngineDoc, runtime.conversationId);
          if (doc.activeId !== task.id) {
            doc.activeId = task.id;
            doc.activeTurn = task.input.turnId;
            doc.dispatch = "ready";
            doc.turnId = null;
            doc.drafts = [];
            doc.error = null;
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
      doc.activeId = null;
      doc.activeTurn = null;
      doc.error = error;
      if (!error) {
        doc.prepared = true;
        doc.preparedComputerId = doc.computerId;
      }
    }
    if (error)
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
    doc.tasks = doc.tasks.filter((id) => id !== runtime.taskId);
    doc.taskId = doc.tasks.at(-1) ?? null;
    return {
      status: "terminal",
      outcome: { status: "completed", result: null },
    };
  }, context);
}
