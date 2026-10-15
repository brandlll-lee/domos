import type { Bots } from "@domos/agent/bots";
import { chatView } from "@domos/agent/view";
import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai/models";
import { ConversationBusy } from "@earendil-works/pi-durable";
import { ORPCError, os } from "@orpc/server";
import { z } from "zod";
import { botConversation, botTarget } from "./conversation.ts";
import { modelRouter, requireConfiguredModel } from "./models.ts";
import { watchValues } from "./subscribe.ts";

export function createRouter(bots: Bots, models: Models) {
  return {
    bots: {
      list: os.handler(() => bots.list(BACKGROUND_CONTEXT)),
      create: os
        .input(
          z.object({
            name: z.string().trim().min(1).max(80),
            instructions: z.string().trim(),
            model: z.object({
              provider: z.string().min(1),
              modelId: z.string().min(1),
            }),
            requestId: z.uuid(),
          }),
        )
        .handler(async ({ input }) => {
          await requireConfiguredModel(models, input.model);
          return bots.create(input, BACKGROUND_CONTEXT);
        }),
      subscribe: os.handler(async function* ({ signal }) {
        const context = signal
          ? withAbortSignal(signal, BACKGROUND_CONTEXT)
          : BACKGROUND_CONTEXT;
        const watch = await bots.watch(context);
        for await (const directory of watchValues(watch, signal))
          yield directory?.items.map(({ id, name }) => ({ id, name })) ?? [];
      }),
    },
    models: modelRouter(bots, models),
    get: os.input(botTarget).handler(async ({ input }) => {
      const conversation = await botConversation(bots, input.botId);
      const view = await conversation.viewState(BACKGROUND_CONTEXT);
      try {
        return chatView(view.value);
      } finally {
        view.dispose();
      }
    }),
    send: os
      .input(
        botTarget.extend({
          text: z.string().trim().min(1),
          requestId: z.uuid(),
        }),
      )
      .handler(async ({ input }) => {
        const conversation = await botConversation(bots, input.botId);
        try {
          await requireConfiguredModel(
            models,
            (await conversation.agent(BACKGROUND_CONTEXT)).model,
          );
          const submission = await conversation.submit(
            {
              type: "input",
              content: input.text,
              requestId: input.requestId,
              whenBusy: "reject",
            },
            BACKGROUND_CONTEXT,
          );
          return { id: submission.id };
        } catch (error) {
          if (error instanceof ConversationBusy)
            throw new ORPCError("CONFLICT");
          throw error;
        }
      }),
    stop: os.input(botTarget).handler(async ({ input }) => {
      const conversation = await botConversation(bots, input.botId);
      await conversation.abort(BACKGROUND_CONTEXT);
      return { ok: true };
    }),
    subscribe: os.input(botTarget).handler(async function* ({ input, signal }) {
      const conversation = await botConversation(bots, input.botId);
      const context = signal
        ? withAbortSignal(signal, BACKGROUND_CONTEXT)
        : BACKGROUND_CONTEXT;
      const watch = await conversation.watch(context);
      for await (const value of watchValues(watch, signal))
        yield chatView(value);
    }),
  };
}

export type AppRouter = ReturnType<typeof createRouter>;
