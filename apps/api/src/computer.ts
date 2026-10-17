import type { Bots } from "@domos/agent/bots";
import type { Computers } from "@domos/agent/computer/catalog";
import { computerSchema } from "@domos/agent/config";
import { WorkError } from "@domos/agent/work";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ORPCError, os } from "@orpc/server";
import { z } from "zod";
import { botConversation, botTarget } from "./conversation.ts";

export function computerRouter(bots: Bots, computers?: Computers) {
  async function access<T>(run: (target: Computers) => Promise<T>) {
    if (!computers)
      throw new ORPCError("SERVICE_UNAVAILABLE", {
        message: "电脑接入尚未配置。",
      });
    try {
      return await run(computers);
    } catch (error) {
      if (error instanceof ORPCError) throw error;
      throw new ORPCError(
        error instanceof WorkError ? error.code : "BAD_REQUEST",
        {
          message:
            error instanceof Error
              ? error.message
              : "电脑操作未确认。请刷新状态。",
        },
      );
    }
  }
  const id = z.string().min(1);
  const context = BACKGROUND_CONTEXT;
  return {
    setup: os.handler(() =>
      access((target) => target.preparation.state(context)),
    ),
    configure: os
      .input(
        botTarget.extend({
          mode: z.enum(["process", "shared", "dedicated"]),
          revision: z.number().int().nonnegative(),
          requestId: z.uuid(),
        }),
      )
      .handler(async ({ input }) => {
        await botConversation(bots, input.botId);
        return access((target) => target.preparation.configure(input, context));
      }),
    prepare: os
      .input(
        botTarget.extend({
          mode: z.enum(["shared", "dedicated"]),
          revision: z.number().int().nonnegative(),
          requestId: z.uuid(),
        }),
      )
      .handler(async ({ input }) => {
        await botConversation(bots, input.botId);
        return access((target) => target.preparation.configure(input, context));
      }),
    list: os.handler(() => access((target) => target.list(context))),
    add: os
      .input(
        z.object({
          name: z.string().trim().min(1).max(80),
          config: computerSchema,
        }),
      )
      .handler(({ input }) => access((target) => target.add(input, context))),
    authorize: os
      .input(z.object({ id, authorized: z.boolean() }))
      .handler(({ input }) =>
        access((target) =>
          target.authorize(input.id, input.authorized, context),
        ),
      ),
    default: os
      .input(z.object({ id: id.nullable() }))
      .handler(({ input }) =>
        access((target) => target.setDefault(input.id, context)),
      ),
    get: os.input(botTarget).handler(async ({ input }) => {
      await botConversation(bots, input.botId);
      return access((target) => target.binding(input.botId, context));
    }),
    assign: os
      .input(
        botTarget.extend({
          computerId: id.nullable(),
          revision: z.number().int().nonnegative(),
          requestId: z.uuid(),
        }),
      )
      .handler(async ({ input }) => {
        await botConversation(bots, input.botId);
        return access((target) => target.assign(input.botId, input, context));
      }),
    manage: os
      .input(z.object({ id, action: z.enum(["start", "stop", "rebuild"]) }))
      .handler(({ input }) =>
        access((target) => target.manage(input.id, input.action, context)),
      ),
  };
}
