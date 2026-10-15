import { modelCatalog } from "@domos/agent/models";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai/models";
import type { Conversation, ModelRef } from "@earendil-works/pi-durable";
import { ORPCError, os } from "@orpc/server";
import { z } from "zod";

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

export function modelRouter(conversation: Conversation, models: Models) {
  return {
    list: os.handler(() => modelCatalog(models)),
    select: os
      .input(
        z.object({ provider: z.string().min(1), modelId: z.string().min(1) }),
      )
      .handler(async ({ input }) => {
        await requireConfiguredModel(models, input);
        await conversation.configure({ model: input }, BACKGROUND_CONTEXT);
        return input;
      }),
  };
}
