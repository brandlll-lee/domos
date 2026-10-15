import type { Bots } from "@domos/agent/bots";
import { modelCatalog } from "@domos/agent/models";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai/models";
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
