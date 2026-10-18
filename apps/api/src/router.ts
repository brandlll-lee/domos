import { MAX_ATTACHMENTS } from "@domos/agent/attachments";
import type { Bots } from "@domos/agent/bots";
import type { Computers } from "@domos/agent/computer/catalog";
import { FileInput, type Files } from "@domos/agent/files";
import type { Engines } from "@domos/agent/harness";
import { stopChat } from "@domos/agent/stop";
import { chatView } from "@domos/agent/view";
import { type BotWork, WorkError } from "@domos/agent/work";
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
import { engineConfig, engineRouter } from "./engines.ts";
import { fileRouter } from "./files.ts";
import { modelRouter, requireConfiguredModel } from "./models.ts";
import { watchValues } from "./subscribe.ts";
import { workRouter } from "./work.ts";

export function createRouter(
  bots: Bots,
  models: Models,
  files: Files,
  work: BotWork,
  computer?: Computers,
  engines?: Engines,
) {
  return {
    computer: computerRouter(bots, computer),
    engines: engineRouter(bots, engines),
    work: workRouter(bots, work, engines),
    files: fileRouter(bots, files, computer),
    bots: {
      list: os.handler(() => bots.list(BACKGROUND_CONTEXT)),
      completeWelcome: os.input(botTarget).handler(async ({ input }) => {
        await botConversation(bots, input.botId);
        await bots.completeWelcome(input.botId, BACKGROUND_CONTEXT);
      }),
      create: os
        .input(
          z.object({
            name: z.string().trim().min(1).max(80),
            instructions: z.string().trim().default(""),
            model: z
              .object({
                provider: z.string().min(1),
                modelId: z.string().min(1),
              })
              .optional(),
            computerId: z.string().min(1).nullable().optional(),
            requestId: z.uuid(),
            avatar: z.uuid().optional(),
            engine: engineConfig.optional(),
          }),
        )
        .handler(async ({ input }) => {
          if (input.model) await requireConfiguredModel(models, input.model);
          try {
            const bot = await bots.create(input, BACKGROUND_CONTEXT);
            if (input.engine && engines)
              await engines.configure(
                bot.id,
                {
                  config: input.engine,
                  revision: 0,
                  requestId: input.requestId,
                },
                BACKGROUND_CONTEXT,
              );
            return bot;
          } catch (error) {
            if (error instanceof WorkError)
              throw new ORPCError(error.code, { message: error.message });
            throw error;
          }
        }),
      subscribe: os.handler(async function* ({ signal }) {
        yield* watchDirectory(bots, computer, signal);
      }),
    },
    models: modelRouter(bots, models, engines),
    get: os.input(botTarget).handler(async ({ input }) => {
      const conversation = await botConversation(bots, input.botId);
      if (engines) return engines.view(input.botId, BACKGROUND_CONTEXT);
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
          if (!engines)
            await requireConfiguredModel(
              models,
              (await conversation.agent(BACKGROUND_CONTEXT)).model,
            );
          const submit = async () => {
            try {
              await files.verify(input.botId, attachments, BACKGROUND_CONTEXT);
            } catch (error) {
              throw new ORPCError("BAD_REQUEST", {
                message:
                  error instanceof Error ? error.message : "附件目标无效。",
              });
            }
            if (engines)
              return engines.submit(
                input.botId,
                { text: input.text, attachments, requestId: input.requestId },
                BACKGROUND_CONTEXT,
              );
            return conversation.submit(
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
          };
          const submission = await (computer
            ? computer.transfer(input.botId, submit, BACKGROUND_CONTEXT)
            : submit());
          await bots.completeWelcome(input.botId, BACKGROUND_CONTEXT);
          return { id: submission.id };
        } catch (error) {
          if (error instanceof WorkError)
            throw new ORPCError(error.code, { message: error.message });
          if (error instanceof ConversationBusy)
            throw new ORPCError("CONFLICT");
          throw error;
        }
      }),
    stop: os.input(botTarget).handler(async ({ input }) => {
      const conversation = await botConversation(bots, input.botId);
      await engines?.stop(input.botId, BACKGROUND_CONTEXT);
      await stopChat(conversation, BACKGROUND_CONTEXT);
      return { ok: true };
    }),
    subscribe: os.input(botTarget).handler(async function* ({ input, signal }) {
      const conversation = await botConversation(bots, input.botId);
      const context = signal
        ? withAbortSignal(signal, BACKGROUND_CONTEXT)
        : BACKGROUND_CONTEXT;
      if (engines) {
        yield* engines.watch(input.botId, context);
        return;
      }
      const watch = await conversation.watch(context);
      for await (const value of watchValues(watch, signal))
        yield chatView(value);
    }),
  };
}

export type AppRouter = ReturnType<typeof createRouter>;
