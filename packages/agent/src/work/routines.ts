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
import { requireRevision, toolResult, WorkError } from "./state.ts";

export type RoutineChange = Partial<RoutineInput> & {
  action: "create" | "update" | "pause" | "resume" | "run_now" | "delete";
};
export type RoutineConfirm = (
  title: string,
  detail: string,
  context: Context,
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
    if (
      !(await confirm(
        `${labels[change.action]}定时：${input.title}`,
        JSON.stringify(
          {
            action: change.action,
            title: input.title,
            instructions: input.instructions,
            schedule: input.schedule,
            skillIds: input.skillIds,
            executionMs: input.executionMs ?? 900_000,
          },
          null,
          2,
        ),
        context,
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
