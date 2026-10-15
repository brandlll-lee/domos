import type { Bots } from "@domos/agent/bots";
import type { Computer } from "@domos/agent/computer";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ORPCError, os } from "@orpc/server";
import { z } from "zod";
import { botConversation, botTarget } from "./conversation.ts";

export function computerRouter(bots: Bots, computer?: Computer) {
  const target = () => {
    if (!computer)
      throw new ORPCError("SERVICE_UNAVAILABLE", {
        message: "电脑接入尚未配置。",
      });
    return computer;
  };
  return {
    get: os.input(botTarget).handler(async ({ input }) => {
      await botConversation(bots, input.botId);
      return target().status();
    }),
    manage: os
      .input(botTarget.extend({ action: z.enum(["start", "stop", "rebuild"]) }))
      .handler(async ({ input }) => {
        await botConversation(bots, input.botId);
        try {
          return await target().manage(
            input.action,
            BACKGROUND_CONTEXT,
            async () => {
              if ((await bots.list(BACKGROUND_CONTEXT)).some((bot) => bot.busy))
                throw new ORPCError("CONFLICT", {
                  message: "请先停止所有 Bot 的工作，再操作共享电脑。",
                });
            },
          );
        } catch (error) {
          if (error instanceof ORPCError) throw error;
          throw new ORPCError("BAD_REQUEST", {
            message:
              error instanceof Error
                ? error.message
                : "电脑操作未确认。请检查实际状态。",
          });
        }
      }),
  };
}
