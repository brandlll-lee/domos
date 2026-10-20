import type { Bots } from "@domos/agent/bots";
import { type Engines, engineCatalog, engineIds } from "@domos/agent/harness";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { ORPCError, os } from "@orpc/server";
import { z } from "zod";
import { botConversation, botTarget } from "./conversation.ts";

export const engineConfig = z
  .object({
    provider: z.enum(engineIds),
    model: z.string().trim().min(1).max(256).nullable(),
    options: z
      .record(z.string().min(1).max(128), z.string().max(1024))
      .optional(),
  })
  .strict();
export function engineRouter(bots: Bots, engines?: Engines) {
  const providerId = z.string().trim().min(1).max(256);
  async function target(botId: number, idle = false) {
    await botConversation(bots, botId);
    if (!engines) throw new ORPCError("NOT_IMPLEMENTED");
    const profile = await engines.profile(botId, context);
    if (idle && profile.busy)
      throw new ORPCError("CONFLICT", { message: "请先停止 Bot 的工作。" });
    return { engines, profile };
  }
  async function operation<T>(action: () => Promise<T>) {
    try {
      return await action();
    } catch (error) {
      if (error instanceof ORPCError) throw error;
      throw new ORPCError("BAD_REQUEST", {
        message:
          error instanceof Error ? error.message : "连接未完成。请重试。",
      });
    }
  }
  return {
    controls: os
      .input(botTarget)
      .handler(({ input }) =>
        operation(async () =>
          (await target(input.botId, true)).engines.controls(
            input.botId,
            context,
          ),
        ),
      ),
    compact: os
      .input(botTarget.extend({ requestId: z.uuid() }))
      .handler(({ input }) =>
        operation(async () => {
          const { engines } = await target(input.botId, true);
          const submission = await engines.submit(
            input.botId,
            {
              text: "",
              requestId: input.requestId,
              whenBusy: "reject",
              operation: "compact",
            },
            context,
          );
          return { id: submission.id };
        }),
      ),
    usage: os
      .input(
        z.object({
          botId: z.number().int().nonnegative().optional(),
          harness: z.enum(engineIds).optional(),
          provider: providerId.optional(),
          model: providerId.optional(),
          from: z.number().nonnegative().optional(),
          to: z.number().nonnegative().optional(),
        }),
      )
      .handler(async ({ input }) =>
        engines
          ? engines.usage(
              (await bots.list(context)).map((bot) => bot.id),
              input,
              context,
            )
          : [],
      ),
    catalog: os.handler(() =>
      engineCatalog().filter((provider) => engines || provider.id === "pi"),
    ),
    get: os.input(botTarget).handler(({ input }) =>
      operation(async () => {
        if (engines) return (await target(input.botId)).profile;
        const profile = await bots.profile(input.botId, context);
        return {
          config: {
            provider: "pi" as const,
            model: profile.model
              ? `${profile.model.provider}/${profile.model.modelId}`
              : null,
          },
          revision: 0,
          prepared: Boolean(profile.model),
          busy: false,
          error: null,
          runtime: null,
          providers: engineCatalog().filter((provider) => provider.id === "pi"),
        };
      }),
    ),
    configure: os
      .input(
        botTarget.extend({
          config: engineConfig,
          revision: z.number().int().nonnegative(),
          requestId: z.uuid(),
        }),
      )
      .handler(({ input }) =>
        operation(async () =>
          (await target(input.botId, true)).engines.configure(
            input.botId,
            input,
            context,
          ),
        ),
      ),
    inspect: os
      .input(botTarget)
      .handler(({ input }) =>
        operation(async () =>
          (await target(input.botId, true)).engines.prepare(
            input.botId,
            context,
          ),
        ),
      ),
    install: os.input(botTarget).handler(({ input }) =>
      operation(async () => {
        const { engines, profile } = await target(input.botId, true);
        await engines.connections.install(input.botId, profile.config, context);
        return { ok: true };
      }),
    ),
    key: os
      .input(
        botTarget.extend({
          key: z.string().trim().min(1).max(16384).nullable(),
          providerId: providerId.optional(),
        }),
      )
      .handler(({ input }) =>
        operation(async () => {
          const { engines, profile } = await target(input.botId, true);
          await engines.connections.key(
            input.botId,
            profile.config,
            input.key,
            context,
            input.providerId,
          );
          return { ok: true };
        }),
      ),
    accounts: os.input(botTarget).handler(({ input }) =>
      operation(async () => {
        const { engines, profile } = await target(input.botId, true);
        return engines.connections.accounts(
          input.botId,
          profile.config,
          context,
        );
      }),
    ),
    login: os
      .input(
        botTarget.extend({
          providerId: providerId.optional(),
          method: z.number().int().min(0).max(100).optional(),
          inputs: z
            .record(z.string().min(1).max(256), z.string().max(16384))
            .optional(),
        }),
      )
      .handler(({ input }) =>
        operation(async () => {
          const { engines, profile } = await target(input.botId, true);
          return engines.connections.login(
            input.botId,
            profile.config,
            context,
            input,
          );
        }),
      ),
    answerLogin: os
      .input(botTarget.extend({ code: z.string().trim().min(1).max(4096) }))
      .handler(({ input }) =>
        operation(async () => {
          await (
            await target(input.botId, true)
          ).engines.connections.answerLogin(input.botId, input.code);
          return { ok: true };
        }),
      ),
    loginState: os
      .input(botTarget)
      .handler(async ({ input }) =>
        (await target(input.botId)).engines.connections.loginState(input.botId),
      ),
    cancelLogin: os.input(botTarget).handler(async ({ input }) => {
      await (await target(input.botId)).engines.connections.cancelLogin(
        input.botId,
      );
      return { ok: true };
    }),
    answer: os
      .input(
        botTarget.extend({
          id: z.string().min(1).max(256),
          allow: z.boolean(),
          text: z.string().max(16000).optional(),
          answers: z
            .record(
              z.string().min(1).max(256),
              z.array(z.string().max(16000)).max(100),
            )
            .optional(),
          optionId: z.string().min(1).max(256).optional(),
        }),
      )
      .handler(({ input }) =>
        operation(async () => {
          await (await target(input.botId)).engines.answer(
            input.botId,
            input.id,
            input,
            context,
          );
          return { ok: true };
        }),
      ),
  };
}
