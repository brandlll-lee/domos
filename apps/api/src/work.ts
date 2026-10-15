import type { Bots } from "@domos/agent/bots";
import { actualPrompt, type BotWork, WorkError } from "@domos/agent/work";
import {
  BOT_NAME_LENGTH,
  ROUTINE_SKILLS_LIMIT,
  SCHEDULE_EXPRESSION_LENGTH,
  SKILL_FILE_BYTES,
  TIME_ZONE_LENGTH,
  WORK_TEXT_LENGTH,
} from "@domos/agent/work/limits";
import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/chord/context";
import { ORPCError, os } from "@orpc/server";
import { z } from "zod";
import { botConversation, botTarget } from "./conversation.ts";

const context = BACKGROUND_CONTEXT;
const id = z.string().min(1).max(128);
const revision = z.number().int().nonnegative();
const requestId = z.uuid();
const itemTarget = botTarget.extend({ id, revision });
const schedule = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("once"),
    at: z.iso.datetime({ offset: true }),
    timeZone: z.string().min(1).max(TIME_ZONE_LENGTH),
  }),
  z.object({
    type: z.literal("cron"),
    expression: z.string().min(1).max(SCHEDULE_EXPRESSION_LENGTH),
    timeZone: z.string().min(1).max(TIME_ZONE_LENGTH),
  }),
]);

export function workRouter(bots: Bots, work: BotWork) {
  async function access<T>(botId: number, action: () => Promise<T>) {
    try {
      await botConversation(bots, botId);
      return await action();
    } catch (error) {
      if (error instanceof WorkError)
        throw new ORPCError(error.code, { message: error.message });
      throw error;
    }
  }
  return {
    profile: os
      .input(botTarget)
      .handler(({ input }) =>
        access(input.botId, () => bots.profile(input.botId, context)),
      ),
    update: os
      .input(
        botTarget.extend({
          name: z.string().trim().min(1).max(BOT_NAME_LENGTH),
          instructions: z.string().max(WORK_TEXT_LENGTH),
          avatar: z.uuid(),
          revision,
          requestId,
        }),
      )
      .handler(({ input }) =>
        access(input.botId, () => bots.update(input.botId, input, context)),
      ),
    prompt: os
      .input(botTarget)
      .handler(({ input }) =>
        access(input.botId, async () =>
          actualPrompt(await botConversation(bots, input.botId), context),
        ),
      ),
    get: os
      .input(botTarget)
      .handler(({ input }) =>
        access(input.botId, () => work.read(input.botId, context)),
      ),
    subscribe: os.input(botTarget).handler(async function* ({ input, signal }) {
      await botConversation(bots, input.botId);
      yield* work.watch(
        input.botId,
        signal ? withAbortSignal(signal, context) : context,
      );
    }),
    memory: {
      save: os
        .input(
          itemTarget.extend({
            text: z.string().min(1).max(WORK_TEXT_LENGTH),
            shared: z.boolean(),
            requestId,
          }),
        )
        .handler(({ input }) =>
          access(input.botId, () =>
            work.memory.save(input.botId, input, context),
          ),
        ),
      delete: os.input(itemTarget).handler(({ input }) =>
        access(input.botId, async () => {
          await work.memory.delete(
            input.botId,
            input.id,
            input.revision,
            context,
          );
          return { ok: true };
        }),
      ),
    },
    skills: {
      save: os
        .input(
          botTarget.extend({
            id,
            content: z.string().min(1).max(SKILL_FILE_BYTES),
            revision,
            requestId,
          }),
        )
        .handler(({ input }) =>
          access(input.botId, () => work.skills.save(input, context)),
        ),
      enable: os
        .input(itemTarget.extend({ enabled: z.boolean(), requestId }))
        .handler(({ input }) =>
          access(input.botId, async () => {
            await work.skills.enable(
              input.botId,
              input.id,
              input.enabled,
              input.revision,
              input.requestId,
              context,
            );
            return { ok: true };
          }),
        ),
      delete: os.input(itemTarget).handler(({ input }) =>
        access(input.botId, async () => {
          await work.skills.delete(input.id, input.revision, context);
          return { ok: true };
        }),
      ),
    },
    routines: {
      save: os
        .input(
          itemTarget.extend({
            title: z.string().trim().min(1).max(BOT_NAME_LENGTH),
            instructions: z.string().trim().min(1).max(WORK_TEXT_LENGTH),
            schedule,
            skillIds: z.array(id).max(ROUTINE_SKILLS_LIMIT),
            requestId,
          }),
        )
        .handler(({ input }) =>
          access(input.botId, () =>
            work.routines.save(input.botId, input, context),
          ),
        ),
      enable: os
        .input(itemTarget.extend({ enabled: z.boolean(), requestId }))
        .handler(({ input }) =>
          access(input.botId, async () => {
            await work.routines.enable(
              input.botId,
              input.id,
              input.enabled,
              input.revision,
              input.requestId,
              context,
            );
            return { ok: true };
          }),
        ),
      test: os.input(botTarget.extend({ id, requestId })).handler(({ input }) =>
        access(input.botId, async () => ({
          taskId: await work.routines.test(
            input.botId,
            input.id,
            input.requestId,
            context,
          ),
        })),
      ),
      delete: os.input(itemTarget).handler(({ input }) =>
        access(input.botId, async () => {
          await work.routines.delete(
            input.botId,
            input.id,
            input.revision,
            context,
          );
          return { ok: true };
        }),
      ),
    },
  };
}
