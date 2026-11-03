import type { Context } from "@earendil-works/chord/context";
import {
  type ConversationId,
  defineTask,
  type TaskRuntime,
} from "@earendil-works/pi-durable";
import { EngineMessage } from "../harness/state.ts";
import { stored } from "../harness/task-types.ts";
import type { EngineInput } from "../harness/types.ts";
import type { Runtime as Engines } from "../runtime/index.ts";
import {
  RoutineInput,
  type RoutineRun,
  RoutinesDoc,
  transitionRun,
} from "./routine-state.ts";
import { nextScheduled } from "./schedule.ts";
import { enabledSkill, SkillsDoc } from "./skills.ts";
export type RoutineDispatch = (
  botId: number,
  input: EngineInput,
  context: Context,
) => ReturnType<Engines["submit"]>;

export type RoutineTaskInput = {
  id: string;
  botId: number;
  revision: number;
  at: number;
  mode: "scheduled" | "test";
  requestId: string;
};
type Checkpoint =
  | { phase: "wait"; at: number }
  | { phase: "run"; at: number; runId: string };
type Runtime = TaskRuntime<RoutineTaskInput, Checkpoint, null, object>;

export function createRoutineTask(
  preflight?: (botId: number, context: Context) => Promise<void>,
  dispatch?: RoutineDispatch,
) {
  return defineTask<RoutineTaskInput, Checkpoint, null, object>({
    name: "domos.routine",
    version: 1,
    initial: ({ at }) => ({ phase: "wait", at }),
    phases: {
      async wait(task, runtime, context) {
        if (runtime.now() < task.state.checkpoint.at) {
          await runtime.sleepUntil(
            task.state.checkpoint.at,
            task.state.checkpoint,
            context,
          );
          return;
        }
        await runtime.commit(async (tx) => {
          const doc = await tx.doc(RoutinesDoc);
          const routine = doc.items.find(
            (item) =>
              item.id === task.input.id && item.botId === task.input.botId,
          );
          if (
            !routine ||
            (task.input.mode === "scheduled" &&
              (!routine.enabled || routine.revision !== task.input.revision))
          )
            return {
              status: "terminal",
              outcome: { status: "completed", result: null },
            };
          const now = runtime.now();
          const at = task.state.checkpoint.at;
          const runId = `${task.id}:${at}`;
          let content = `Scheduled task: ${routine.title}\n${routine.instructions}`;
          if (routine.delivery === "conditional")
            content += `
Monitoring condition: ${routine.condition}
Previous successful baseline: ${routine.baseline ?? "Unknown; establish the first baseline unless the explicit condition is already met."}
Use routine_report once after checking evidence. Do not send ordinary chat updates. Its text is the single notification when notify is true. Reuse existing file references for attachments.`;
          let error: string | null = null;
          try {
            const skills = await tx.doc(SkillsDoc);
            for (const id of routine.skillIds) {
              const skill = enabledSkill(skills.items, routine.botId, id);
              content += `\n\nUse enabled skill ${skill.name} (revision ${skill.revision}). Read skill_read with id "${skill.id}" for supporting files:\n${skill.content}`;
            }
          } catch {
            error = "绑定技能已删除或未启用。请修改任务后重试。";
          }
          doc.runs.push({
            id: runId,
            routineId: routine.id,
            botId: routine.botId,
            title: routine.title,
            mode: task.input.mode,
            revision: routine.revision,
            delivery: routine.delivery ?? "always",
            ...(routine.condition ? { condition: routine.condition } : {}),
            scheduledAt: at,
            firedAt: now,
            finishedAt: null,
            coalesced:
              routine.schedule.type === "cron" &&
              (nextScheduled(routine.schedule, at) ?? Infinity) <= now,
            status: "queued",
            error,
            content,
            requestId: `routine:${task.input.requestId}:${at}`,
            submissionId: null,
            executionMs: routine.executionMs ?? 900_000,
            activeMs: 0,
            waitingMs: 0,
            changedAt: now,
          });
          if (task.input.mode === "scheduled") routine.nextAt = null;
          return { status: "running", checkpoint: { phase: "run", at, runId } };
        }, context);
      },
      async run(task, runtime, context) {
        const checkpoint = task.state.checkpoint;
        await finishRun(
          checkpoint.runId,
          runtime,
          context,
          preflight,
          dispatch,
        );
        await runtime.commit(async (tx) => {
          const doc = await tx.doc(RoutinesDoc);
          const routine = doc.items.find(
            (item) =>
              item.id === task.input.id && item.botId === task.input.botId,
          );
          if (
            routine &&
            task.input.mode === "scheduled" &&
            routine.enabled &&
            routine.revision === task.input.revision
          ) {
            routine.nextAt = nextScheduled(routine.schedule, runtime.now());
            if (routine.nextAt !== null)
              return {
                status: "running",
                checkpoint: { phase: "wait", at: routine.nextAt },
              };
            routine.enabled = false;
            routine.taskId = null;
          }
          return {
            status: "terminal",
            outcome: { status: "completed", result: null },
          };
        }, context);
      },
    },
    async abort(task, runtime, context) {
      if (task.state.checkpoint.phase === "run")
        await finishRun(
          task.state.checkpoint.runId,
          runtime,
          context,
          preflight,
          dispatch,
        );
      await runtime.commit(
        () => ({ status: "terminal", outcome: { status: "aborted" } }),
        context,
      );
    },
  });
}

export const routineTask = createRoutineTask();

async function finishRun(
  id: string,
  runtime: Runtime,
  context: Context,
  preflight?: (botId: number, context: Context) => Promise<void>,
  dispatch?: RoutineDispatch,
) {
  const run = (await runtime.snapshot(RoutinesDoc, context))?.runs.find(
    (item) => item.id === id,
  );
  if (!run || ["done", "failed", "stopped"].includes(run.status)) return;
  let status: RoutineRun["status"] = "failed";
  let error = run.error;
  let submissionId = run.submissionId;
  if (!error) {
    try {
      await preflight?.(run.botId, context);
      ({ status, error, submissionId } = await submitRun(
        run,
        runtime,
        context,
        dispatch,
      ));
    } catch (cause) {
      if (runtime.signal.aborted || context.abortSignal?.aborted) throw cause;
      runtime.report(cause);
      error =
        cause instanceof Error
          ? cause.message
          : "任务提交失败。请检查 Bot 配置。";
    }
  }
  await runtime.commit(async (tx) => {
    const doc = await tx.doc(RoutinesDoc);
    const saved = doc.runs.find((item) => item.id === id);
    if (saved && !["done", "failed", "stopped"].includes(saved.status)) {
      if (saved.delivery === "conditional" && status === "done") {
        if (!saved.report) {
          status = "failed";
          error = "监控未提交有效检查结论。";
        } else {
          const item = doc.items.find(
            (item) => item.id === saved.routineId && item.botId === saved.botId,
          );
          saved.delivered = false;
          if (item && item.revision === saved.revision) {
            item.baseline = saved.report.summary;
            if (saved.report.notify && saved.report.key !== item.notifiedKey) {
              saved.delivered = true;
              item.notifiedKey = saved.report.key;
              await tx.appendEntry(saved.botId as ConversationId, {
                kind: EngineMessage,
                data: stored({
                  id: `routine-result:${saved.id}`,
                  turnId: saved.turnId,
                  role: "assistant",
                  stopped: false,
                  routine: {
                    runId: saved.id,
                    title: saved.title,
                    scheduledAt: saved.scheduledAt,
                    turnId: saved.turnId,
                  },
                  ...(saved.files?.length ? { attachments: saved.files } : {}),
                  timestamp: runtime.now(),
                  content: [
                    { type: "text", text: saved.report.text, key: saved.id },
                  ],
                }),
              });
            }
          }
        }
      }
      if (
        saved.delivery === "conditional" &&
        (status === "failed" || status === "stopped")
      )
        await tx.appendEntry(saved.botId as ConversationId, {
          kind: EngineMessage,
          data: stored({
            id: `routine-status:${saved.id}`,
            turnId: saved.turnId,
            role: "assistant",
            stopped: false,
            routine: {
              runId: saved.id,
              title: saved.title,
              scheduledAt: saved.scheduledAt,
              turnId: saved.turnId,
            },
            timestamp: runtime.now(),
            content: [
              { type: "text", text: error ?? "监控已停止。", key: saved.id },
            ],
          }),
        });
      transitionRun(saved, status, runtime.now());
      Object.assign(saved, {
        status,
        error,
        submissionId,
        finishedAt: runtime.now(),
      });
    }
  }, context);
}

async function submitRun(
  run: RoutineRun,
  runtime: Runtime,
  context: Context,
  dispatch?: RoutineDispatch,
) {
  const conversation = await runtime.conversation(
    run.botId as ConversationId,
    context,
  );
  if (!conversation) throw new Error("Bot不存在。");
  const submission = dispatch
    ? await dispatch(
        run.botId,
        {
          text: run.content,
          displayText: `${run.mode === "test" ? "试跑" : "定时任务"}：${run.title}`,
          requestId: run.requestId,
          whenBusy: "followUp",
          routineRunId: run.id,
          source: "routine",
        },
        context,
      )
    : await conversation.submit(
        {
          type: "input",
          content: run.content,
          requestId: run.requestId,
          whenBusy: "followUp",
          entry: {
            kind: RoutineInput,
            data: {
              text: `${run.mode === "test" ? "试跑" : "定时任务"}：${run.title}`,
              routineId: run.routineId,
              runId: run.id,
            },
          },
        },
        context,
      );
  await runtime.commit(async (tx) => {
    const saved = (await tx.doc(RoutinesDoc)).runs.find(
      (item) => item.id === run.id,
    );
    if (saved) saved.submissionId = submission.id;
  }, context);
  const result = await submission.wait(context);
  return {
    status:
      result.status === "done"
        ? ("done" as const)
        : result.reason === "aborted"
          ? ("stopped" as const)
          : ("failed" as const),
    error: result.status === "unanswered" ? result.reason : null,
    submissionId: submission.id,
  };
}
