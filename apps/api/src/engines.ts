import type { Bots } from "@domos/agent/bots";
import { engineIds } from "@domos/agent/harness/types";
import type { Runtime } from "@domos/agent/runtime";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { ORPCError, os } from "@orpc/server";
import { z } from "zod";
import { botConversation, botTarget } from "./conversation.ts";

export function engineRouter(bots: Bots, runtime?: Runtime) {
  async function target(botId: number) {
    await botConversation(bots, botId);
    if (!runtime) throw new ORPCError("NOT_IMPLEMENTED");
    return runtime;
  }
  return {
    get: os
      .input(botTarget)
      .handler(async ({ input }) =>
        (await target(input.botId)).profile(input.botId, context),
      ),
    compact: os
      .input(botTarget.extend({ requestId: z.uuid() }))
      .handler(async ({ input }) => ({
        id: await (await target(input.botId)).compact(
          input.botId,
          input.requestId,
          context,
        ),
      })),
    usage: os
      .input(
        z.object({
          botId: z.number().int().nonnegative().optional(),
          harness: z.enum(engineIds).optional(),
          provider: z.string().max(256).optional(),
          model: z.string().max(256).optional(),
          from: z.number().nonnegative().optional(),
          to: z.number().nonnegative().optional(),
        }),
      )
      .handler(async ({ input }) =>
        runtime
          ? runtime.usage(
              (await bots.list(context)).map((bot) => bot.id),
              input,
              context,
            )
          : [],
      ),
    takeRequest: os
      .input(botTarget.extend({ id: z.uuid(), view: z.uuid() }))
      .handler(async ({ input }) =>
        (await target(input.botId)).takeRequest(
          input.botId,
          input.id,
          input.view,
          context,
        ),
      ),
    answer: os
      .input(
        botTarget.extend({
          id: z.string().min(1).max(256),
          allow: z.boolean(),
          text: z.string().max(16000).optional(),
          answers: z
            .record(
              z.string().max(256),
              z.array(z.string().max(16000)).max(100),
            )
            .optional(),
          optionId: z.string().max(256).optional(),
        }),
      )
      .handler(async ({ input }) => {
        await (await target(input.botId)).answer(
          input.botId,
          input.id,
          input,
          context,
        );
        return { ok: true };
      }),
  };
}
