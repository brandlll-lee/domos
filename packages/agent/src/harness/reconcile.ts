import type { Context } from "@earendil-works/chord/context";
import type {
  ConversationId,
  Harness,
  TaskId,
  Tx,
} from "@earendil-works/pi-durable";
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
      ? [(task.input as EngineTaskInput).submissionId]
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
    settlements.push((task.input as EngineTaskInput).submissionId);
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
      if (draft.pending !== false) draft.stopped = true;
      await tx.appendEntry(id, { kind: EngineMessage, data: stored(draft) });
    }
    doc.drafts = [];
    doc.approvals = [];
    doc.activeId = null;
    doc.activeTurn = null;
    doc.error = error;
  }
  doc.tasks = doc.tasks.filter((taskId) => !terminal.has(taskId));
  doc.taskId = doc.tasks.at(-1) ?? null;
  return doc;
}
