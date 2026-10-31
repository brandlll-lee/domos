import { defineDoc, type Tx } from "@earendil-works/pi-durable";
import { BOT_NAME_LENGTH, WORK_TEXT_LENGTH } from "./limits.ts";
import type { Schedule } from "./schedule.ts";
import { validateSchedule } from "./schedule.ts";
import { enabledSkill, SkillsDoc } from "./skills.ts";
import { requiredText, requireRevision, WorkError } from "./state.ts";

export type Routine = {
  id: string;
  botId: number;
  title: string;
  instructions: string;
  schedule: Schedule;
  skillIds: string[];
  enabled: boolean;
  nextAt: number | null;
  taskId: number | null;
  revision: number;
  requestId: string;
  source: string;
  executionMs?: number;
};

export const RoutineInput = "domos.routine-input";
export type RoutineInput = Pick<
  Routine,
  | "id"
  | "title"
  | "instructions"
  | "schedule"
  | "skillIds"
  | "revision"
  | "requestId"
  | "executionMs"
>;
export type RoutineRun = {
  id: string;
  routineId: string;
  botId: number;
  title: string;
  mode: "scheduled" | "test";
  scheduledAt: number;
  firedAt: number;
  finishedAt: number | null;
  coalesced: boolean;
  status:
    | "queued"
    | "running"
    | "waiting_answer"
    | "waiting_approval"
    | "done"
    | "failed"
    | "stopped";
  error: string | null;
  content: string;
  requestId: string;
  submissionId: number | null;
  turnId?: string;
  executionMs?: number;
  activeMs?: number;
  waitingMs?: number;
  changedAt?: number;
};

export const RoutinesDoc = defineDoc<{ items: Routine[]; runs: RoutineRun[] }>({
  kind: "domos.routines",
  version: 1,
  checkpointWhen: () => false,
  scope: "session",
  initial: () => ({ items: [], runs: [] }),
});

export function findRoutine(
  items: readonly Routine[],
  botId: number,
  id: string,
) {
  const routine = items.find((item) => item.botId === botId && item.id === id);
  if (!routine) throw new WorkError("NOT_FOUND", "定时任务不存在。");
  return routine;
}

export async function saveRoutine(
  tx: Tx,
  botId: number,
  input: RoutineInput,
  now: number,
  source: string,
) {
  const doc = await tx.doc(RoutinesDoc);
  const previous = doc.items.find((item) => item.id === input.id);
  if (previous && previous.botId !== botId)
    throw new WorkError("NOT_FOUND", "定时任务不存在。");
  if (previous?.requestId === input.requestId) return { ...previous };
  requireRevision(previous?.revision ?? 0, input.revision);
  const skills = await tx.doc(SkillsDoc);
  for (const id of input.skillIds) enabledSkill(skills.items, botId, id);
  if (
    input.executionMs !== undefined &&
    (!Number.isInteger(input.executionMs) ||
      input.executionMs < 1000 ||
      input.executionMs > 86_400_000)
  )
    throw new WorkError("BAD_REQUEST", "执行期限必须在 1 秒至 24 小时之间。");
  const item: Routine = {
    ...input,
    botId,
    executionMs: input.executionMs ?? previous?.executionMs ?? 900_000,
    title: requiredText(input.title, BOT_NAME_LENGTH),
    instructions: requiredText(input.instructions, WORK_TEXT_LENGTH),
    schedule: validateSchedule(input.schedule, now),
    skillIds: [...new Set(input.skillIds)],
    revision: input.revision + 1,
    enabled: false,
    nextAt: null,
    taskId: null,
    source,
  };
  if (previous) Object.assign(previous, item);
  else doc.items.push(item);
  return item;
}

export function transitionRun(
  run: RoutineRun,
  status: RoutineRun["status"],
  now: number,
) {
  const elapsed = Math.max(0, now - (run.changedAt ?? run.firedAt));
  if (run.status === "running") run.activeMs = (run.activeMs ?? 0) + elapsed;
  if (run.status === "waiting_answer" || run.status === "waiting_approval")
    run.waitingMs = (run.waitingMs ?? 0) + elapsed;
  run.status = status;
  run.changedAt = now;
}
