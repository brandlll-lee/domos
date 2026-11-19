import type { Bots } from "@domos/agent/bots";
import { approvalModes } from "@domos/agent/harness/types";
import { engineCatalog, type Runtime } from "@domos/agent/runtime";
import { WorkError } from "@domos/agent/work";
import {
  BACKGROUND_CONTEXT as context,
  withAbortSignal,
} from "@earendil-works/chord/context";
import { ORPCError, os } from "@orpc/server";
import { z } from "zod";
import { botConversation, botTarget } from "./conversation.ts";

const config = z
  .object({
    provider: z
      .string()
      .min(1)
      .max(128)
      .refine((id) => engineCatalog().some((item) => item.id === id)),
    model: z.string().min(1).max(256).nullable(),
    approvalMode: z.enum(approvalModes).optional(),
    command: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => !value.includes("\0"))
      .optional(),
    args: z
      .array(
        z
          .string()
          .max(4096)
          .refine((value) => !value.includes("\0")),
      )
      .max(64)
      .optional(),
    options: z
      .record(z.string().min(1).max(128), z.string().max(1024))
      .optional(),
  })
  .strict();

const usageFilter = z.object({
  botId: z.number().int().nonnegative().optional(),
  harness: z.string().min(1).max(128).optional(),
  provider: z.string().max(256).optional(),
  model: z.string().max(256).optional(),
  from: z.number().nonnegative().optional(),
  to: z.number().nonnegative().optional(),
  query: z.string().trim().max(200).optional(),
});

export function engineRouter(bots: Bots, runtime?: Runtime) {
  async function target(botId: number) {
    await botConversation(bots, botId);
    if (!runtime) throw new ORPCError("NOT_IMPLEMENTED");
    return runtime;
  }
  async function usageScope(
    input: z.infer<typeof usageFilter>,
    signal?: AbortSignal,
  ) {
    const scoped = signal ? withAbortSignal(signal, context) : context;
    const available = await bots.list(scoped);
    const query = input.query?.toLocaleLowerCase();
    return {
      botIds: available.map((bot) => bot.id),
      context: scoped,
      filter: {
        ...input,
        searchBots: query
          ? available
              .filter((bot) => bot.name.toLocaleLowerCase().includes(query))
              .map((bot) => bot.id)
          : [],
      },
    };
  }
  return {
    catalog: os.handler(() => engineCatalog()),
    available: os.input(botTarget).handler(async ({ input }) => {
      const runtime = await target(input.botId);
      return runtime.connections.inspect(
        input.botId,
        (await runtime.profile(input.botId, context)).config,
        context,
      );
    }),
    select: os
      .input(
        botTarget.extend({
          model: config.shape.model,
          options: config.shape.options,
          revision: z.number().int().nonnegative(),
          requestId: z.uuid(),
        }),
      )
      .handler(async ({ input }) => {
        try {
          const runtime = await target(input.botId);
          return await runtime.select(input.botId, input, context);
        } catch (error) {
          if (error instanceof WorkError)
            throw new ORPCError(error.code, { message: error.message });
          throw error;
        }
      }),
    configure: os
      .input(
        botTarget.extend({
          config,
          revision: z.number().int().nonnegative(),
          requestId: z.uuid(),
        }),
      )
      .handler(async ({ input }) => {
        try {
          return await (await target(input.botId)).configure(
            input.botId,
            input,
            context,
          );
        } catch (error) {
          if (error instanceof WorkError)
            throw new ORPCError(error.code, { message: error.message });
          throw error;
        }
      }),
    models: os.input(botTarget).handler(async ({ input }) => {
      const runtime = await target(input.botId);
      return runtime.connections.catalog(
        input.botId,
        context,
        (await runtime.profile(input.botId, context)).config,
      );
    }),
    status: os
      .input(botTarget.extend({ config, refresh: z.boolean().optional() }))
      .handler(async ({ input }) => {
        const runtime = await target(input.botId);
        return runtime.connections.status(
          input.botId,
          input.config,
          context,
          input.refresh,
        );
      }),
    inspect: os
      .input(
        botTarget.extend({
          config: config.optional(),
          provider: config.shape.provider.optional(),
          refresh: z.boolean().optional(),
        }),
      )
      .handler(async ({ input }) => {
        const runtime = await target(input.botId);
        const selected =
          input.config ?? (await runtime.profile(input.botId, context)).config;
        return runtime.connections.inspect(
          input.botId,
          input.provider ? { ...selected, provider: input.provider } : selected,
          context,
          input.refresh,
        );
      }),
    install: os
      .input(botTarget.extend({ config }))
      .handler(async ({ input }) => {
        const runtime = await target(input.botId);
        if ((await runtime.profile(input.botId, context)).busy)
          throw new ORPCError("CONFLICT");
        const config = await runtime.connections.install(
          input.botId,
          input.config,
          context,
        );
        return {
          config,
          connection: await runtime.connections.inspect(
            input.botId,
            config,
            context,
            true,
          ),
        };
      }),
    login: os
      .input(
        botTarget.extend({
          config,
          providerId: z.string().max(256).optional(),
          method: z.number().int().nonnegative().optional(),
          inputs: z
            .record(z.string().max(256), z.string().max(4096))
            .optional(),
        }),
      )
      .handler(async ({ input }) =>
        (await target(input.botId)).connections.login(
          input.botId,
          input.config,
          context,
          input,
        ),
      ),
    loginState: os
      .input(botTarget)
      .handler(async ({ input }) =>
        (await target(input.botId)).connections.loginState(input.botId),
      ),
    cancelLogin: os
      .input(botTarget)
      .handler(async ({ input }) =>
        (await target(input.botId)).connections.cancelLogin(input.botId),
      ),
    answerLogin: os
      .input(botTarget.extend({ code: z.string().min(1).max(4096) }))
      .handler(async ({ input }) =>
        (await target(input.botId)).connections.answerLogin(
          input.botId,
          input.code,
        ),
      ),
    controls: os
      .input(botTarget)
      .handler(async ({ input }) =>
        (await target(input.botId)).controls(input.botId, context),
      ),
    get: os
      .input(botTarget)
      .handler(async ({ input }) =>
        (await target(input.botId)).profile(input.botId, context),
      ),
    compact: os
      .input(botTarget.extend({ requestId: z.uuid() }))
      .handler(async ({ input }) => {
        try {
          return {
            id: await (await target(input.botId)).compact(
              input.botId,
              input.requestId,
              context,
            ),
          };
        } catch (error) {
          if (error instanceof WorkError)
            throw new ORPCError(error.code, { message: error.message });
          throw error;
        }
      }),
    usage: os
      .input(
        usageFilter.extend({
          page: z.number().int().min(1).max(1_000_000).optional(),
        }),
      )
      .handler(async ({ input, signal }) => {
        const scope = await usageScope(input, signal);
        return runtime
          ? runtime.usage(scope.botIds, scope.filter, scope.context)
          : { items: [], total: 0, page: 1, pageSize: 50 };
      }),
    usageSummary: os
      .input(
        usageFilter.extend({
          dimension: z.enum(["model", "provider", "harness", "bot"]),
          metric: z.enum(["cost", "tasks", "input", "output"]),
          limit: z.number().int().min(1).max(20),
        }),
      )
      .handler(async ({ input, signal }) => {
        if (!runtime)
          throw new ORPCError("NOT_FOUND", { message: "用量服务不可用。" });
        const scope = await usageScope(input, signal);
        return runtime.usageSummary(
          scope.botIds,
          scope.filter,
          input.dimension,
          input.metric,
          input.limit,
          scope.context,
        );
      }),
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
    credentials: os
      .input(
        botTarget.extend({
          id: z.string().min(1).max(256),
          values: z.record(z.string().min(1).max(256), z.string().max(32768)),
        }),
      )
      .handler(async ({ input }) => {
        await (await target(input.botId)).credentials(
          input.botId,
          input.id,
          input.values,
          context,
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
