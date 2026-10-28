import type { Bots } from "@domos/agent/bots";
import { modelCatalog, modelProviders } from "@domos/agent/models";
import type { Runtime } from "@domos/agent/runtime";
import { WorkError } from "@domos/agent/work";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai/models";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/models";
import type { ModelRef } from "@earendil-works/pi-durable";
import { ORPCError, os } from "@orpc/server";
import { z } from "zod";
import { botConversation, botTarget } from "./conversation.ts";

export async function requireConfiguredModel(
  models: Models,
  selection: ModelRef | undefined,
) {
  const model =
    selection &&
    (await models.getAvailable(selection.provider)).find(
      (model) => model.id === selection.modelId,
    );
  if (!model) throw new ORPCError("PRECONDITION_FAILED");
  return model;
}

export function modelRouter(bots: Bots, models: Models, runtime?: Runtime) {
  const nativeSelect = async (...args: Parameters<Runtime["select"]>) => {
    try {
      return await runtime?.select(...args);
    } catch (error) {
      if (error instanceof WorkError)
        throw new ORPCError(error.code, { message: error.message });
      throw error;
    }
  };
  return {
    thinking: os
      .input(botTarget.extend({ thinkingLevel: z.string().max(32) }))
      .handler(async ({ input }) => {
        const conversation = await botConversation(bots, input.botId);
        if (runtime) {
          const profile = await runtime.profile(
            input.botId,
            BACKGROUND_CONTEXT,
          );
          const controls = await runtime.controls(
            input.botId,
            BACKGROUND_CONTEXT,
          );
          const effort = controls.options.find(
            (option) => option.kind === "effort",
          );
          if (
            !effort?.options.some((option) => option.id === input.thinkingLevel)
          )
            throw new ORPCError("BAD_REQUEST");
          await nativeSelect(
            input.botId,
            {
              model: profile.config.model,
              options: {
                ...profile.config.options,
                [effort.id]: input.thinkingLevel,
              },
              revision: profile.revision,
              requestId: crypto.randomUUID(),
            },
            BACKGROUND_CONTEXT,
          );
          return { ok: true };
        }
        const selection = (await conversation.agent(BACKGROUND_CONTEXT)).model;
        const model = (await models.getAvailable()).find(
          (item) =>
            item.provider === selection?.provider &&
            item.id === selection.modelId,
        );
        if (!model) throw new ORPCError("BAD_REQUEST");
        const level = getSupportedThinkingLevels(model).find(
          (item) => item === input.thinkingLevel,
        );
        if (input.thinkingLevel && !level) throw new ORPCError("BAD_REQUEST");
        await conversation.configure(
          { thinkingLevel: level ?? null },
          BACKGROUND_CONTEXT,
        );
        return { ok: true };
      }),
    visibility: os.handler(() => bots.modelVisibility(BACKGROUND_CONTEXT)),
    setVisibility: os
      .input(
        z.object({
          harness: z.string().min(1).max(128),
          model: z.string().min(1).max(256),
          visible: z.boolean(),
        }),
      )
      .handler(({ input }) =>
        bots.setModelVisibility(input, BACKGROUND_CONTEXT),
      ),
    refresh: os
      .input(z.object({ provider: z.string().min(1).max(256) }))
      .handler(async ({ input, signal }) => {
        if (!models.getProvider(input.provider))
          throw new ORPCError("BAD_REQUEST");
        const timeout = AbortSignal.timeout(15_000);
        const result = await models.refresh({
          providers: [input.provider],
          allowNetwork: true,
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        if (result.aborted || result.errors.size)
          throw new ORPCError("BAD_GATEWAY", {
            message: "模型目录刷新失败。请重试。",
          });
        return modelCatalog(models);
      }),
    list: os.handler(() => modelCatalog(models)),
    providers: os.handler(() => modelProviders(models)),
    select: os
      .input(
        botTarget.extend({
          provider: z.string().min(1),
          modelId: z.string().min(1),
        }),
      )
      .handler(async ({ input }) => {
        if (runtime) {
          await botConversation(bots, input.botId);
          const profile = await runtime.profile(
            input.botId,
            BACKGROUND_CONTEXT,
          );
          if (profile.config.provider !== "pi")
            throw new ORPCError("BAD_REQUEST", {
              message: "请使用当前 Harness 的模型选择接口。",
            });
          await nativeSelect(
            input.botId,
            {
              model: `${input.provider}/${input.modelId}`,
              revision: profile.revision,
              requestId: crypto.randomUUID(),
            },
            BACKGROUND_CONTEXT,
          );
          return { provider: input.provider, modelId: input.modelId };
        }
        const selected = await requireConfiguredModel(models, input);
        const conversation = await botConversation(bots, input.botId);
        const model = { provider: input.provider, modelId: input.modelId };
        const agent = await conversation.agent(BACKGROUND_CONTEXT);
        await conversation.configure(
          {
            model,
            thinkingLevel: getSupportedThinkingLevels(selected).includes(
              agent.thinkingLevel,
            )
              ? agent.thinkingLevel
              : null,
          },
          BACKGROUND_CONTEXT,
        );
        return model;
      }),
  };
}
