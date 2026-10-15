import { MAX_FILE_BYTES } from "@domos/agent/attachments";
import type { Bots } from "@domos/agent/bots";
import type { Files } from "@domos/agent/files";
import { ORPCError, os } from "@orpc/server";
import { z } from "zod";
import { botConversation, botTarget } from "./conversation.ts";

export function fileRouter(bots: Bots, files: Files) {
  return {
    upload: os
      .input(botTarget.extend({ file: z.file().max(MAX_FILE_BYTES) }))
      .handler(async ({ input }) => {
        await botConversation(bots, input.botId);
        try {
          return await files.upload(
            input.botId,
            input.file.name,
            new Uint8Array(await input.file.arrayBuffer()),
          );
        } catch {
          throw new ORPCError("BAD_REQUEST", {
            message: "文件上传失败。请检查文件名与大小。",
          });
        }
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
