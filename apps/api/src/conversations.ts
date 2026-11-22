import type { Bots } from "@domos/agent/bots";
import { WorkError } from "@domos/agent/work";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { ORPCError, os } from "@orpc/server";
import { z } from "zod";
import { botTarget } from "./conversation.ts";

export function conversationRouter(bots: Bots) {
  async function access<T>(action: () => Promise<T>) {
    try {
      return await action();
    } catch (error) {
      if (error instanceof WorkError)
        throw new ORPCError(error.code, { message: error.message });
      throw error;
    }
  }
  return {
    create: os
      .input(
        botTarget.extend({
          source: z.number().int().nonnegative(),
          requestId: z.uuid(),
        }),
      )
      .handler(({ input }) =>
        access(async () => ({
          id: await bots.createSession(
            input.botId,
            input.source,
            input.requestId,
            context,
          ),
        })),
      ),
    update: os
      .input(
        botTarget.extend({
          id: z.number().int().nonnegative(),
          title: z.string().trim().min(1).max(80).optional(),
          archived: z.boolean().optional(),
        }),
      )
      .handler(({ input }) =>
        access(async () => {
          await bots.updateSession(input.botId, input.id, input, context);
          return { ok: true };
        }),
      ),
  };
}
