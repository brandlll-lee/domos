import { Readable } from "node:stream";
import { MAX_FILE_BYTES } from "@domos/agent/attachments";
import type { Bots } from "@domos/agent/bots";
import type { Computers } from "@domos/agent/computer/catalog";
import { conversationFiles, type Files } from "@domos/agent/files";
import { chatView } from "@domos/agent/view";
import { WorkError } from "@domos/agent/work";
import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/chord/context";
import { ORPCError, os } from "@orpc/server";
import { z } from "zod";
import { botConversation, botTarget } from "./conversation.ts";

export function fileRouter(bots: Bots, files: Files, computers?: Computers) {
  async function discard(botId: number, id: string) {
    botId = await bots.owner(botId, BACKGROUND_CONTEXT);
    for (const session of await bots.sessionIds(botId, BACKGROUND_CONTEXT)) {
      const conversation = await botConversation(bots, session);
      const state = await conversation.viewState(BACKGROUND_CONTEXT);
      try {
        if (
          chatView(state.value).messages.some((message) =>
            message.attachments?.some((file) => file.id === id),
          )
        )
          return;
      } finally {
        state.dispose();
      }
    }
    await files.discard(botId, id);
  }
  return {
    list: os
      .input(
        botTarget.extend({
          query: z.string().max(200).default(""),
          offset: z.number().int().nonnegative().default(0),
          limit: z.number().int().min(1).max(100).default(50),
        }),
      )
      .handler(async ({ input, signal }) => {
        const conversation = await botConversation(bots, input.botId);
        return conversationFiles(
          conversation,
          input.query,
          input.offset,
          input.limit,
          signal
            ? withAbortSignal(signal, BACKGROUND_CONTEXT)
            : BACKGROUND_CONTEXT,
        );
      }),
    upload: os
      .input(
        botTarget.extend({
          file: z.file().max(MAX_FILE_BYTES),
          requestId: z.uuid().optional(),
        }),
      )
      .handler(async ({ input, signal }) => {
        await botConversation(bots, input.botId);
        const owner = await bots.owner(input.botId, BACKGROUND_CONTEXT);
        try {
          const upload = () =>
            files.exclusive(owner, async () => {
              signal?.throwIfAborted();
              const file = await files.uploadStream(
                owner,
                input.file.name,
                Readable.fromWeb(
                  input.file.stream() as import("node:stream/web").ReadableStream<Uint8Array>,
                ),
                signal
                  ? withAbortSignal(signal, BACKGROUND_CONTEXT)
                  : BACKGROUND_CONTEXT,
                input.requestId,
              );
              if (signal?.aborted) {
                await discard(input.botId, file.id);
                signal.throwIfAborted();
              }
              return file;
            });
          return await (computers
            ? computers.transfer(owner, upload, BACKGROUND_CONTEXT)
            : upload());
        } catch (error) {
          throw new ORPCError("BAD_REQUEST", {
            message:
              error instanceof WorkError
                ? error.message
                : `${input.file.name}：文件未送达工作电脑。请检查电脑连接后重试。`,
          });
        }
      }),
    discard: os
      .input(botTarget.extend({ id: z.string().regex(/^[a-f0-9]{64}$/) }))
      .handler(async ({ input }) => {
        await botConversation(bots, input.botId);
        const owner = await bots.owner(input.botId, BACKGROUND_CONTEXT);
        const cleanup = () =>
          files.exclusive(owner, () => discard(owner, input.id));
        await (computers
          ? computers.transfer(owner, cleanup, BACKGROUND_CONTEXT)
          : cleanup());
      }),
    download: os
      .input(botTarget.extend({ id: z.string().regex(/^[a-f0-9]{64}$/) }))
      .handler(async ({ input }) => {
        await botConversation(bots, input.botId);
        try {
          return await files.download(
            await bots.owner(input.botId, BACKGROUND_CONTEXT),
            input.id,
          );
        } catch {
          throw new ORPCError("NOT_FOUND");
        }
      }),
  };
}
