import type { Context } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import {
  type ConversationId,
  defineExtension,
  defineTool,
  type Harness,
  section,
  type TaskId,
} from "@earendil-works/pi-durable";
import { BOT_NAME_LENGTH, WORK_TEXT_LENGTH } from "./limits.ts";
import {
  findRoutine,
  type RoutineInput,
  RoutinesDoc,
  saveRoutine,
} from "./routine-state.ts";
import { createRoutineTask, routineTask } from "./routine-task.ts";
import { nextScheduled, validateSchedule } from "./schedule.ts";
import { requireRevision, toolResult } from "./state.ts";

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

  async save(botId: number, input: RoutineInput, context: Context) {
    const result = await this.harness.commit(async (tx) => {
      const previous = (await tx.doc(RoutinesDoc)).items.find(
        (item) => item.id === input.id && item.botId === botId,
      );
      const taskId =
        previous?.requestId === input.requestId ? null : previous?.taskId;
      const item = await saveRoutine(tx, botId, input, this.now(), "user");
      return { item, taskId };
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
      item.enabled = enabled;
      item.revision++;
      item.requestId = requestId;
      item.nextAt = null;
      item.taskId = null;
      if (enabled) {
        validateSchedule(item.schedule, this.now());
        item.nextAt = nextScheduled(item.schedule, this.now());
        item.taskId = await tx.createTask(
          routineTask,
          {
            id,
            botId,
            revision: item.revision,
            at: item.nextAt as number,
            mode: "scheduled" as const,
            requestId,
          },
          {
            conversationId: botId as ConversationId,
            ownership: { kind: "conversation" },
            background: true,
          },
        );
      }
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

  private async retire(id: number | null | undefined, context: Context) {
    if (id !== null && id !== undefined)
      await this.harness.abortTask(id as TaskId, context);
  }
}

export function routineExtension(
  now = Date.now,
  preflight?: (botId: number, context: Context) => Promise<void>,
) {
  return defineExtension({
    name: "domos-routines",
    tasks: [createRoutineTask(preflight)],
    sections: [
      section(
        "routines",
        () =>
          `Current host time: ${new Date(now()).toISOString()}. Host timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}. Use routine_create when the user requests future or repeated work. Confirm the intended timezone when unclear. New routines are paused. Ask the user to review and enable them in Bot details. Schedules execute only while the Domos host is running; after restart, missed repeats are coalesced into one run. Routine work uses the same tools and permissions as chat. Results return to this Bot's conversation. Never claim cloud availability.`,
      ),
    ],
    tools: [
      defineTool({
        name: "routine_list",
        description: "Read this Bot's routines and their run receipts.",
        parameters: Type.Object({}),
        async execute(_args, api, context) {
          const doc = await api.snapshot(RoutinesDoc, context);
          return toolResult({
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
          "Save a paused routine for user review. Specify an explicit IANA timeZone. Once uses an ISO timestamp with offset. Cron uses five fields. Bind enabled skills by stable ID. The user enables the routine in Bot details.",
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
        }),
        replay: "safe",
        executionMode: "sequential",
        async execute(args, api, context) {
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
