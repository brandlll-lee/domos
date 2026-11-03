import type { Context } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import {
  type ConversationId,
  defineExtension,
  defineTool,
  type Harness,
  section,
  type TaskId,
  type Tx,
} from "@earendil-works/pi-durable";
import { EngineDoc } from "../harness/state.ts";
import { BOT_NAME_LENGTH, WORK_TEXT_LENGTH } from "./limits.ts";
import {
  findRoutine,
  type RoutineInput,
  RoutinesDoc,
  saveRoutine,
} from "./routine-state.ts";
import {
  createRoutineTask,
  type RoutineDispatch,
  routineTask,
} from "./routine-task.ts";
import { nextScheduled, validateSchedule } from "./schedule.ts";
import { routineTimeLabel } from "./schedule-label.ts";
import { SkillsDoc } from "./skills.ts";
import { requireRevision, toolResult, WorkError } from "./state.ts";

export type RoutineChange = Partial<RoutineInput> & {
  action: "create" | "update" | "pause" | "resume" | "run_now" | "delete";
};
export type RoutineConfirm = (
  title: string,
  detail: string,
  context: Context,
  presentation?: Pick<
    import("../harness/types.ts").EngineApproval,
    "fields" | "confirmLabel"
  >,
) => Promise<boolean>;

async function scheduleRoutine(
  tx: Tx,
  item: import("./routine-state.ts").Routine,
  enabled: boolean,
  requestId: string,
  now: number,
) {
  item.enabled = enabled;
  item.nextAt = null;
  item.taskId = null;
  if (!enabled) return;
  validateSchedule(item.schedule, now);
  item.nextAt = nextScheduled(item.schedule, now);
  item.taskId = await tx.createTask(
    routineTask,
    {
      id: item.id,
      botId: item.botId,
      revision: item.revision,
      at: item.nextAt as number,
      mode: "scheduled" as const,
      requestId,
    },
    {
      conversationId: item.botId as ConversationId,
      ownership: { kind: "conversation" },
      background: true,
    },
  );
}

export class Routines {
  private readonly harness: Harness;
  private readonly now: () => number;
  constructor(harness: Harness, now = Date.now) {
    this.harness = harness;
    this.now = now;
  }

  async list(botId: number, context: Context) {
    const doc = await this.harness.snapshot(RoutinesDoc, context);
    return {
      items: doc?.items.filter((item) => item.botId === botId) ?? [],
      runs: doc?.runs.filter((item) => item.botId === botId) ?? [],
    };
  }

  async save(
    botId: number,
    input: RoutineInput,
    context: Context,
    enabled = false,
  ) {
    const result = await this.harness.commit(async (tx) => {
      const previous = (await tx.doc(RoutinesDoc)).items.find(
        (item) => item.id === input.id && item.botId === botId,
      );
      const taskId =
        previous?.requestId === input.requestId ? null : previous?.taskId;
      const duplicate = previous?.requestId === input.requestId;
      await saveRoutine(tx, botId, input, this.now(), "user");
      const item = findRoutine(
        (await tx.doc(RoutinesDoc)).items,
        botId,
        input.id,
      );
      if (!duplicate)
        await scheduleRoutine(tx, item, enabled, input.requestId, this.now());
      return { item: JSON.parse(JSON.stringify(item)) as typeof item, taskId };
    }, context);
    await this.retire(result.taskId, context);
    return result.item;
  }

  async enable(
    botId: number,
    id: string,
    enabled: boolean,
    revision: number,
    requestId: string,
    context: Context,
  ) {
    const taskId = await this.harness.commit(async (tx) => {
      const item = findRoutine((await tx.doc(RoutinesDoc)).items, botId, id);
      if (item.requestId === requestId) return null;
      requireRevision(item.revision, revision);
      const previous = item.taskId;
      item.revision++;
      item.requestId = requestId;
      await scheduleRoutine(tx, item, enabled, requestId, this.now());
      return previous;
    }, context);
    await this.retire(taskId, context);
  }

  async test(botId: number, id: string, requestId: string, context: Context) {
    return this.harness.commit(async (tx) => {
      const doc = await tx.doc(RoutinesDoc);
      const item = findRoutine(doc.items, botId, id);
      const tasks = await tx.scanTasks(
        {
          conversationId: botId as ConversationId,
          kind: routineTask.definition.name,
        },
        Number.MAX_SAFE_INTEGER,
      );
      const previous = tasks.items.find(
        (task) =>
          (task.input as { requestId?: string }).requestId === requestId,
      );
      if (previous) return previous.id;
      return tx.createTask(
        routineTask,
        {
          id,
          botId,
          revision: item.revision,
          at: this.now(),
          mode: "test" as const,
          requestId,
        },
        {
          conversationId: botId as ConversationId,
          ownership: { kind: "conversation" },
          background: true,
        },
      );
    }, context);
  }

  async delete(botId: number, id: string, revision: number, context: Context) {
    const taskId = await this.harness.commit(async (tx) => {
      const doc = await tx.doc(RoutinesDoc);
      const item = doc.items.find(
        (item) => item.botId === botId && item.id === id,
      );
      if (!item) return null;
      requireRevision(item.revision, revision);
      doc.items = doc.items.filter((item) => item.id !== id);
      return item.taskId;
    }, context);
    await this.retire(taskId, context);
  }

  async manage(
    botId: number,
    change: RoutineChange,
    requestId: string,
    confirm: RoutineConfirm,
    context: Context,
  ) {
    const current = (await this.list(botId, context)).items.find(
      (item) => item.id === change.id,
    );
    if (current?.requestId === requestId) return current;
    if (change.action !== "create" && !current)
      throw new WorkError("NOT_FOUND", "定时任务不存在。");
    if (current) requireRevision(current.revision, change.revision ?? -1);
    const input = {
      ...current,
      ...change,
      id: change.id ?? `routine-${requestId}`,
      revision: current?.revision ?? 0,
      requestId,
    } as RoutineInput;
    if (change.action === "create" || change.action === "update") {
      if (
        !input.title?.trim() ||
        !input.instructions?.trim() ||
        !input.schedule
      )
        throw new WorkError("BAD_REQUEST", "缺少名称、要求或执行时间。");
      validateSchedule(input.schedule, this.now());
      input.skillIds ??= [];
    }
    const labels = {
      create: "创建",
      update: "修改",
      pause: "暂停",
      resume: "恢复",
      run_now: "立即执行",
      delete: "删除",
    };
    const fields = routineFields(input);
    const previousFields = current ? routineFields(current) : [];
    if (change.action === "update" && input.title !== current?.title) {
      fields.unshift({ label: "任务名称", value: input.title });
      previousFields.unshift({
        label: "任务名称",
        value: current?.title ?? "",
      });
    }
    if (input.skillIds.length || current?.skillIds.length) {
      const skills =
        (await this.harness.snapshot(SkillsDoc, context))?.items ?? [];
      const names = (ids: string[]) =>
        ids
          .map((id) => skills.find((skill) => skill.id === id)?.name ?? id)
          .join("、") || "未绑定";
      fields.push({ label: "使用技能", value: names(input.skillIds) });
      previousFields.push({
        label: "使用技能",
        value: names(current?.skillIds ?? []),
      });
    }
    if (
      !(await confirm(
        `${labels[change.action]}定时：${input.title}`,
        change.action === "update" &&
          input.instructions === current?.instructions
          ? ""
          : (input.instructions ?? ""),
        context,
        {
          confirmLabel: `${labels[change.action]}任务`,
          fields: fields.flatMap((field) => {
            if (change.action !== "update" || !current) return [field];
            const previous = previousFields.find(
              (item) => item.label === field.label,
            );
            return previous?.value === field.value
              ? []
              : [
                  {
                    ...field,
                    value: previous
                      ? `${previous.value} → ${field.value}`
                      : field.value,
                  },
                ];
          }),
        },
      ))
    )
      return { status: "declined" };
    context.abortSignal?.throwIfAborted();
    if (change.action === "delete") {
      await this.delete(botId, input.id, input.revision, context);
      return { status: "deleted" };
    }
    if (change.action === "run_now")
      return { taskId: await this.test(botId, input.id, requestId, context) };
    const enabled =
      change.action === "create" ||
      change.action === "resume" ||
      (change.action === "update" && current?.enabled === true);
    if (change.action === "create" || change.action === "update")
      return this.save(botId, input, context, enabled);
    await this.enable(
      botId,
      input.id,
      enabled,
      input.revision,
      requestId,
      context,
    );
    return (await this.list(botId, context)).items.find(
      (item) => item.id === input.id,
    );
  }

  private async retire(id: number | null | undefined, context: Context) {
    if (id !== null && id !== undefined)
      await this.harness.abortTask(id as TaskId, context);
  }
}

export function routineExtension(
  now = Date.now,
  preflight?: (botId: number, context: Context) => Promise<void>,
  dispatch?: RoutineDispatch,
  manage?: (
    botId: number,
    change: RoutineChange,
    requestId: string,
    context: Context,
  ) => Promise<unknown>,
) {
  return defineExtension({
    name: "domos-routines",
    tasks: [createRoutineTask(preflight, dispatch)],
    sections: [
      section(
        "routines",
        () =>
          `Host timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}. Read routine_list for current host time before resolving relative dates. Use routine_create for future or repeated work. Use routine_manage to update, pause, resume, run now or delete a routine by ID and current revision. Changes require the user confirmation card. Confirm the intended timezone when unclear. Approved routines become enabled. Never claim a change took effect before confirmation. Schedules execute only while the Domos host is running; after restart, missed repeats are coalesced into one run. Routine work uses the same tools and permissions as chat. Results return to this Bot's conversation. Never claim cloud availability.`,
      ),
    ],
    tools: [
      defineTool({
        name: "routine_report",
        description:
          "Submit this monitoring run's result. notify is true only when the agreed condition is met. Supply a stable source key when notifying. summary becomes the bounded next-run baseline after successful completion. Call exactly once after checking actual evidence.",
        parameters: Type.Object({
          notify: Type.Boolean(),
          text: Type.String({ maxLength: WORK_TEXT_LENGTH }),
          summary: Type.String({ minLength: 1, maxLength: WORK_TEXT_LENGTH }),
          key: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
        }),
        replay: "safe",
        executionMode: "sequential",
        async execute(args, api, context) {
          return toolResult(
            await api.commit(async (tx) => {
              const task = await tx.task(api.taskId);
              const parent = (task?.input as { parent?: TaskId } | undefined)
                ?.parent;
              const owner = parent ? await tx.task(parent) : task;
              const engine = await tx.doc(EngineDoc, api.conversationId);
              if (engine.activeId !== owner?.id)
                throw new WorkError("CONFLICT", "本轮执行已结束。");
              const input = owner?.input as
                | { routineRunId?: string }
                | undefined;
              const doc = await tx.doc(RoutinesDoc);
              const run = doc.runs.find(
                (run) =>
                  run.id === input?.routineRunId &&
                  run.botId === api.conversationId,
              );
              if (run?.delivery !== "conditional" || run.status !== "running")
                throw new WorkError(
                  "BAD_REQUEST",
                  "当前没有可提交结论的监控运行。",
                );
              if (args.notify && (!args.text.trim() || !args.key?.trim()))
                throw new WorkError(
                  "BAD_REQUEST",
                  "通知需要正文与稳定事项标识。",
                );
              if (
                run.report &&
                JSON.stringify(run.report) !== JSON.stringify(args)
              )
                throw new WorkError("CONFLICT", "本轮已经提交检查结论。");
              run.report = args;
              return { accepted: true };
            }, context),
          );
        },
      }),
      defineTool({
        name: "routine_manage",
        description:
          "Propose a routine change for user confirmation. Read routine_list first. Supply its stable ID and current revision. Update only the fields that must change. Execution time excludes waiting for user input.",
        parameters: Type.Object({
          action: Type.Union(
            ["update", "pause", "resume", "run_now", "delete"].map((value) =>
              Type.Literal(value),
            ),
          ),
          id: Type.String(),
          revision: Type.Integer({ minimum: 0 }),
          title: Type.Optional(
            Type.String({ minLength: 1, maxLength: BOT_NAME_LENGTH }),
          ),
          instructions: Type.Optional(
            Type.String({ minLength: 1, maxLength: WORK_TEXT_LENGTH }),
          ),
          schedule: Type.Optional(
            Type.Union([
              Type.Object({
                type: Type.Literal("once"),
                at: Type.String(),
                timeZone: Type.String(),
              }),
              Type.Object({
                type: Type.Literal("cron"),
                expression: Type.String(),
                timeZone: Type.String(),
              }),
            ]),
          ),
          skillIds: Type.Optional(Type.Array(Type.String())),
          delivery: Type.Optional(
            Type.Union([Type.Literal("always"), Type.Literal("conditional")]),
          ),
          condition: Type.Optional(
            Type.String({ minLength: 1, maxLength: WORK_TEXT_LENGTH }),
          ),
          executionMs: Type.Optional(
            Type.Integer({ minimum: 1000, maximum: 86_400_000 }),
          ),
        }),
        replay: "safe",
        executionMode: "sequential",
        async execute(args, api, context) {
          if (!manage) throw new WorkError("BAD_REQUEST", "确认服务不可用。");
          return toolResult(
            await manage(
              api.conversationId,
              args as RoutineChange,
              String(api.taskId),
              context,
            ),
          );
        },
      }),
      defineTool({
        name: "routine_list",
        description:
          "Read current host time, timezone, this Bot's routines and their run receipts.",
        parameters: Type.Object({}),
        async execute(_args, api, context) {
          const doc = await api.snapshot(RoutinesDoc, context);
          return toolResult({
            now: new Date(now()).toISOString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            items:
              doc?.items.filter((item) => item.botId === api.conversationId) ??
              [],
            runs:
              doc?.runs.filter((item) => item.botId === api.conversationId) ??
              [],
          });
        },
      }),
      defineTool({
        name: "routine_create",
        description:
          "Create a routine after user confirmation. Specify an explicit IANA timeZone. Once uses an ISO timestamp with offset. Cron uses five fields. Bind enabled skills by stable ID. An approval card confirms the schedule and instructions.",
        parameters: Type.Object({
          title: Type.String({ minLength: 1, maxLength: BOT_NAME_LENGTH }),
          instructions: Type.String({
            minLength: 1,
            maxLength: WORK_TEXT_LENGTH,
          }),
          schedule: Type.Union([
            Type.Object({
              type: Type.Literal("once"),
              at: Type.String(),
              timeZone: Type.String(),
            }),
            Type.Object({
              type: Type.Literal("cron"),
              expression: Type.String(),
              timeZone: Type.String(),
            }),
          ]),
          skillIds: Type.Optional(Type.Array(Type.String())),
          delivery: Type.Optional(
            Type.Union([Type.Literal("always"), Type.Literal("conditional")]),
          ),
          condition: Type.Optional(
            Type.String({ minLength: 1, maxLength: WORK_TEXT_LENGTH }),
          ),
          executionMs: Type.Optional(
            Type.Integer({ minimum: 1000, maximum: 86_400_000 }),
          ),
        }),
        replay: "safe",
        executionMode: "sequential",
        async execute(args, api, context) {
          if (manage)
            return toolResult(
              await manage(
                api.conversationId,
                {
                  ...args,
                  action: "create",
                  id: `routine-${api.taskId}`,
                  revision: 0,
                  skillIds: args.skillIds ?? [],
                },
                String(api.taskId),
                context,
              ),
            );
          return toolResult(
            await api.commit(
              (tx) =>
                saveRoutine(
                  tx,
                  api.conversationId,
                  {
                    ...args,
                    id: `routine-${api.taskId}`,
                    revision: 0,
                    requestId: String(api.taskId),
                    skillIds: args.skillIds ?? [],
                  },
                  now(),
                  `bot:${api.conversationId}/tool:${api.callId}`,
                ),
              context,
            ),
          );
        },
      }),
    ],
  });
}

function routineFields(input: RoutineInput) {
  return [
    {
      label: "执行时间",
      value:
        input.schedule.type === "once"
          ? new Date(input.schedule.at).toLocaleString("zh-CN", {
              timeZone: input.schedule.timeZone,
            })
          : routineTimeLabel(input.schedule.expression),
    },
    { label: "时区", value: input.schedule.timeZone },
    {
      label: "执行期限",
      value: `${(input.executionMs ?? 900_000) / 60_000} 分钟（不含等待）`,
    },
    {
      label: "交付方式",
      value:
        input.delivery === "conditional"
          ? `满足条件才通知：${input.condition}`
          : "每次交付",
    },
  ];
}
