import { MAX_FILE_BYTES } from "@domos/agent/attachments";
import type { Bots } from "@domos/agent/bots";
import type { Computers } from "@domos/agent/computer/catalog";
import type { Files } from "@domos/agent/files";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ORPCError, os } from "@orpc/server";
import { z } from "zod";
import { botConversation, botTarget } from "./conversation.ts";

export function fileRouter(bots: Bots, files: Files, computers?: Computers) {
  return {
    upload: os
      .input(botTarget.extend({ file: z.file().max(MAX_FILE_BYTES) }))
      .handler(async ({ input }) => {
        await botConversation(bots, input.botId);
        try {
          const bytes = new Uint8Array(await input.file.arrayBuffer());
          const upload = () =>
            files.upload(input.botId, input.file.name, bytes);
          return await (computers
            ? computers.transfer(input.botId, upload, BACKGROUND_CONTEXT)
            : upload());
        } catch {
          throw new ORPCError("BAD_REQUEST", {
            message:
              "文件未送达工作电脑。请检查文件名、大小及电脑连接，再重试上传。",
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
