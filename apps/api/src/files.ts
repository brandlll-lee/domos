import { MAX_FILE_BYTES } from "@domos/agent/attachments";
import type { Bots } from "@domos/agent/bots";
import type { Computers } from "@domos/agent/computer/catalog";
import type { Files } from "@domos/agent/files";
import { chatView } from "@domos/agent/view";
import { WorkError } from "@domos/agent/work";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ORPCError, os } from "@orpc/server";
import { z } from "zod";
import { botConversation, botTarget } from "./conversation.ts";

export function fileRouter(bots: Bots, files: Files, computers?: Computers) {
  async function discard(botId: number, id: string) {
    const conversation = await botConversation(bots, botId);
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
    await files.discard(botId, id);
  }
  return {
    upload: os
      .input(
        botTarget.extend({
          file: z.file().max(MAX_FILE_BYTES),
          requestId: z.uuid().optional(),
        }),
      )
      .handler(async ({ input, signal }) => {
        await botConversation(bots, input.botId);
        try {
          const bytes = new Uint8Array(await input.file.arrayBuffer());
          const upload = () =>
            files.exclusive(input.botId, async () => {
              signal?.throwIfAborted();
              const file = await files.upload(
                input.botId,
                input.file.name,
                bytes,
                BACKGROUND_CONTEXT,
                input.requestId,
              );
              if (signal?.aborted) {
                await discard(input.botId, file.id);
                signal.throwIfAborted();
              }
              return file;
            });
          return await (computers
            ? computers.transfer(input.botId, upload, BACKGROUND_CONTEXT)
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
        const cleanup = () =>
          files.exclusive(input.botId, () => discard(input.botId, input.id));
        await (computers
          ? computers.transfer(input.botId, cleanup, BACKGROUND_CONTEXT)
          : cleanup());
      }),
    download: os
      .input(botTarget.extend({ id: z.string().regex(/^[a-f0-9]{64}$/) }))
      .handler(async ({ input }) => {
        await botConversation(bots, input.botId);
        try {
          return await files.download(input.botId, input.id);
        } catch {
          throw new ORPCError("NOT_FOUND");
        }
      }),
  };
}
