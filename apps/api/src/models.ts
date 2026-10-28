import type { Bots } from "@domos/agent/bots";
import { engineIds } from "@domos/agent/harness/types";
import { modelCatalog } from "@domos/agent/models";
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
  if (
    !selection ||
    !(await models.getAvailable(selection.provider)).some(
      (model) => model.id === selection.modelId,
    )
  )
    throw new ORPCError("PRECONDITION_FAILED");
}

export function modelRouter(bots: Bots, models: Models) {
  return {
    thinking: os
      .input(botTarget.extend({ thinkingLevel: z.string().max(32) }))
      .handler(async ({ input }) => {
        const conversation = await botConversation(bots, input.botId);
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
        if (!model || !level) throw new ORPCError("BAD_REQUEST");
        await conversation.configure(
          { thinkingLevel: level },
          BACKGROUND_CONTEXT,
        );
        return { ok: true };
      }),
    visibility: os.handler(() => bots.modelVisibility(BACKGROUND_CONTEXT)),
    setVisibility: os
      .input(
        z.object({
          harness: z.enum(engineIds),
          model: z.string().min(1).max(256),
          visible: z.boolean(),
        }),
      )
      .handler(({ input }) =>
        bots.setModelVisibility(input, BACKGROUND_CONTEXT),
      ),
    list: os.handler(() => modelCatalog(models)),
    select: os
      .input(
        botTarget.extend({
          provider: z.string().min(1),
          modelId: z.string().min(1),
        }),
      )
      .handler(async ({ input }) => {
        await requireConfiguredModel(models, input);
        const conversation = await botConversation(bots, input.botId);
        const model = { provider: input.provider, modelId: input.modelId };
        await conversation.configure({ model }, BACKGROUND_CONTEXT);
        return model;
      }),
  };
}
