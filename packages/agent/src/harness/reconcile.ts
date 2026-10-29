import type { Context } from "@earendil-works/chord/context";
import type {
  ConversationId,
  Harness,
  TaskId,
  Tx,
} from "@earendil-works/pi-durable";
import { ComputerRequests } from "../computer/runtime.ts";
import { projectContext } from "./context.ts";
import { EngineDoc, EngineInputDoc, EngineMessage } from "./state.ts";
import { type EngineTaskInput, stored } from "./task-types.ts";

export async function readEngine(
  harness: Harness,
  id: ConversationId,
  context: Context,
) {
  const doc = await harness.snapshot(EngineDoc, id, context);
  return doc?.tasks.length
    ? harness.commit(
        async (tx) => stored(await reconcileEngine(tx, id)),
        context,
      )
    : doc;
}

export async function stopEngine(tx: Tx, id: ConversationId) {
  const doc = await tx.doc(EngineDoc, id);
  const tasks = [...doc.tasks];
  const records = await Promise.all(tasks.map((taskId) => tx.task(taskId)));
  await reconcileEngine(tx, id);
  if (!doc.tasks.length) return [];
  if (doc.activeId && doc.runtime?.compaction === "running")
    await projectContext(
      tx,
      doc,
      { taskId: doc.activeId },
      {
        type: "compaction",
        status: "uncertain",
        error: "工作已停止。压缩结果未确认。",
      },
    );
  for (const [index, taskId] of tasks.entries()) {
    const task = records[index];
    if (!task || task.state.status === "terminal") continue;
    (await tx.doc(EngineInputDoc, taskId)).status = "settled";
    const submissionId = (task?.input as EngineTaskInput | undefined)
      ?.submissionId;
    if (submissionId)
      tx.settleSubmission(submissionId, {
        status: "unanswered",
        reason: "aborted",
      });
  }
  const requests = await tx.doc(ComputerRequests, id);
  for (const approval of requests.approvals) {
    if (!approval.takeover) continue;
    await tx.appendEntry(id, {
      kind: EngineMessage,
      data: {
        id: approval.id,
        role: "assistant",
        content: [
          { type: "text", text: approval.detail, key: approval.id },
          ...(approval.preview
            ? [{ ...approval.preview, key: `${approval.id}:preview` }]
            : []),
        ],
        timestamp: Date.now(),
        stopped: true,
        takeover: { ...approval.takeover, state: "expired" },
      },
    });
  }
  requests.approvals = [];
  for (const draft of doc.drafts) {
    if (draft.takeover?.state === "waiting") draft.takeover.state = "expired";
    if (draft.pending !== false) draft.stopped = true;
    await tx.appendEntry(id, { kind: EngineMessage, data: stored(draft) });
  }
  if (doc.run && !doc.run.endedAt) {
    doc.run.status = "stopped";
    doc.run.endedAt = Date.now();
    await tx.appendEntry(id, {
      kind: "domos.engine-run",
      data: stored(doc.run),
    });
  }
  doc.drafts = [];
  doc.tasks = [];
  doc.taskId = null;
  doc.activeId = null;
  doc.activeTurn = null;
  doc.dispatch = "ready";
  doc.error = null;
  if (doc.runtime) {
    doc.runtime.processing = false;
    delete doc.runtime.retry;
  }
  return tasks;
}

export async function reconcileEngine(tx: Tx, id: ConversationId) {
  const doc = await tx.doc(EngineDoc, id);
  const tasks = await Promise.all(doc.tasks.map((taskId) => tx.task(taskId)));
  const terminal = new Set<TaskId>(
    tasks.flatMap((task) =>
      task?.state.status === "terminal" ? [task.id] : [],
    ),
  );
  if (!terminal.size) return doc;
  const settlements = tasks.flatMap((task) =>
    task && terminal.has(task.id)
      ? [(task.input as EngineTaskInput).submissionId].filter(
          (id): id is NonNullable<typeof id> => id !== undefined,
        )
      : [],
  );
  for (const task of tasks) {
    if (!task || terminal.has(task.id)) continue;
    const input = await tx.doc(EngineInputDoc, task.id);
    if (
      !input.owner ||
      !terminal.has(input.owner) ||
      input.status === "settled"
    )
      continue;
    input.status = "settled";
    const submissionId = (task.input as EngineTaskInput).submissionId;
    if (submissionId) settlements.push(submissionId);
  }
  const active = tasks.find((task) => task?.id === doc.activeId);
  const error =
    active?.state.status === "terminal" &&
    active.state.outcome.status === "faulted"
      ? active.state.outcome.error.message
      : "任务已结束。执行结果未确认，请核对后再发送。";
  for (const submissionId of settlements)
    tx.settleSubmission(submissionId, { status: "unanswered", reason: error });
  if (doc.activeId && terminal.has(doc.activeId)) {
    for (const draft of doc.drafts) {
      if (draft.takeover?.state === "waiting") draft.takeover.state = "expired";
      if (draft.pending !== false) draft.stopped = true;
      await tx.appendEntry(id, { kind: EngineMessage, data: stored(draft) });
    }
    if (doc.run) {
      doc.run.status = "uncertain";
      doc.run.endedAt = active?.endedAt ?? Date.now();
      await tx.appendEntry(id, {
        kind: "domos.engine-run",
        data: stored(doc.run),
      });
    }
    doc.drafts = [];
    doc.activeId = null;
    doc.activeTurn = null;
    doc.error = error;
  }
  doc.tasks = doc.tasks.filter((taskId) => !terminal.has(taskId));
  doc.taskId = doc.tasks.at(-1) ?? null;
  return doc;
}
