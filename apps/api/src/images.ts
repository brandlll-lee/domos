import type { Bots } from "@domos/agent/bots";
import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/chord/context";
import { ORPCError, os } from "@orpc/server";
import { z } from "zod";
import { botConversation, botTarget } from "./conversation.ts";

export function imageRouter(bots: Bots) {
  const service = async (botId: number) => {
    await botConversation(bots, botId);
    if (!bots.images) throw new Error("图像服务不可用。");
    return bots.images;
  };
  async function run<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          error instanceof Error ? error.message : "图像服务操作未完成。",
      });
    }
  }
  const context = (signal?: AbortSignal) =>
    signal ? withAbortSignal(signal, BACKGROUND_CONTEXT) : BACKGROUND_CONTEXT;
  return {
    state: os
      .input(botTarget)
      .handler(async ({ input, signal }) =>
        run(async () =>
          (await service(input.botId)).state(input.botId, context(signal)),
        ),
      ),
    save: os
      .input(
        botTarget.extend({
          computerId: z.string().min(1),
          name: z.string().trim().min(1).max(80),
          baseUrl: z.url().max(2048),
          apiKey: z.string().max(4096).optional(),
          model: z.enum(["gpt-image-2.6-flare", "gpt-image-2.6-sunburst"]),
          quality: z.enum(["low", "medium", "high"]),
          complexity: z.enum(["low", "medium", "high"]),
          revision: z.number().int().nonnegative(),
        }),
      )
      .handler(async ({ input, signal }) =>
        run(async () =>
          (await service(input.botId)).save(
            input.botId,
            input,
            context(signal),
          ),
        ),
      ),
    test: os
      .input(botTarget)
      .handler(async ({ input, signal }) =>
        run(async () =>
          (await service(input.botId)).test(input.botId, context(signal)),
        ),
      ),
    preview: os
      .input(botTarget.extend({ requestId: z.uuid(), animated: z.boolean() }))
      .handler(async ({ input, signal }) =>
        run(async () =>
          (await service(input.botId)).generate(
            input.botId,
            {
              prompt:
                "A small friendly green dinosaur, full body, fixed camera, generous clear border. " +
                (input.animated
                  ? "Blink and wave gently in a seamless loop."
                  : "Neutral pose."),
              format: input.animated ? "gif" : "png",
              transparent: true,
              count: 1,
            },
            `preview:${input.requestId}`,
            context(signal),
          ),
        ),
      ),
  };
}
