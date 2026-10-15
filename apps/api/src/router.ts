import { MAX_ATTACHMENTS } from "@domos/agent/attachments";
import type { Bots } from "@domos/agent/bots";
import type { Computer } from "@domos/agent/computer";
import { FileInput, type Files } from "@domos/agent/files";
import { chatView } from "@domos/agent/view";
import type { BotWork } from "@domos/agent/work";
import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai/models";
import { ConversationBusy } from "@earendil-works/pi-durable";
import { ORPCError, os } from "@orpc/server";
import { z } from "zod";
import { computerRouter } from "./computer.ts";
import { botConversation, botTarget } from "./conversation.ts";
import { watchDirectory } from "./directory.ts";
import { fileRouter } from "./files.ts";
import { modelRouter, requireConfiguredModel } from "./models.ts";
import { watchValues } from "./subscribe.ts";
import { workRouter } from "./work.ts";

export function createRouter(
  bots: Bots,
  models: Models,
  files: Files,
  work: BotWork,
  computer?: Computer,
) {
  return {
    computer: computerRouter(bots, computer),
    work: workRouter(bots, work),
    files: fileRouter(bots, files),
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
            avatar: z.uuid().optional(),
          }),
        )
        .handler(async ({ input }) => {
          await requireConfiguredModel(models, input.model);
          return bots.create(input, BACKGROUND_CONTEXT);
        }),
      subscribe: os.handler(async function* ({ signal }) {
        yield* watchDirectory(bots, computer, signal);
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
          text: z.string().trim(),
          attachments: z
            .array(z.string().regex(/^[a-f0-9]{64}$/))
            .max(MAX_ATTACHMENTS)
            .default([]),
          requestId: z.uuid(),
        }),
      )
      .handler(async ({ input }) => {
        const conversation = await botConversation(bots, input.botId);
        if (!input.text && !input.attachments.length)
          throw new ORPCError("BAD_REQUEST");
        const attachments = await Promise.all(
          input.attachments.map(async (id) => {
            try {
              return await files.metadata(input.botId, id);
            } catch {
              throw new ORPCError("NOT_FOUND");
            }
          }),
        );
        try {
          await requireConfiguredModel(
            models,
            (await conversation.agent(BACKGROUND_CONTEXT)).model,
          );
          const submission = await conversation.submit(
            {
              type: "input",
              content: [
                input.text,
                ...attachments.map((file) => `Uploaded file: ${file.path}`),
              ]
                .filter(Boolean)
                .join("\n\n"),
              ...(attachments.length
                ? {
                    entry: {
                      kind: FileInput,
                      data: { text: input.text, attachments },
                    },
                  }
                : {}),
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
