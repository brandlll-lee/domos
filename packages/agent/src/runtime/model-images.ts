import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import {
  AgentDoc,
  defineExtension,
  GenerationTask,
  hook,
} from "@earendil-works/pi-durable";
import {
  DEFAULT_IMAGE_LIMITS,
  type ImageProcessor,
} from "@earendil-works/pi-durable/tools";

export function modelImages(images: ImageProcessor) {
  async function normalize(
    content: readonly (TextContent | ImageContent)[],
    limits: typeof DEFAULT_IMAGE_LIMITS,
    discard = 0,
  ) {
    if (!content.some((part) => part.type === "image")) return content;
    const output: (TextContent | ImageContent)[] = [];
    for (const part of content) {
      if (part.type !== "image") {
        output.push(part);
        continue;
      }
      if (discard-- > 0) {
        output.push({
          type: "text",
          text: "[Earlier tool image retained in the stored tool result. Use conversation_read to locate its saved evidence.]",
        });
        continue;
      }
      // Image processing must preserve an action result when its observation cannot be decoded.
      const prepared = await images
        .prepare(
          Uint8Array.from(Buffer.from(part.data, "base64")),
          part.mimeType,
          limits,
        )
        .catch(() => undefined);
      if (!prepared) {
        output.push(part);
        continue;
      }
      output.push({
        type: "image",
        data: prepared.data,
        mimeType: prepared.mimeType,
      });
      if (prepared.resized) {
        const { from, to } = prepared.resized;
        output.push({
          type: "text",
          text: `[Image: original ${from.width}x${from.height}, displayed at ${to.width}x${to.height}. Map coordinates to original: multiply x by ${from.width / to.width} and y by ${from.height / to.height}.]`,
        });
      }
    }
    return output;
  }
  return defineExtension({
    name: "domos-model-images",
    hooks: [
      hook(GenerationTask, {
        beforeRequest: async ({ messages }, api, context) => {
          const agent = await api.snapshot(
            AgentDoc,
            api.conversationId,
            context,
          );
          const ref = agent?.model;
          const model = ref && api.models.getModel(ref.provider, ref.modelId);
          const limits = {
            ...DEFAULT_IMAGE_LIMITS,
            ...model?.inputLimits?.images?.resize,
          };
          const toolLimits = {
            ...limits,
            maxBytes: Math.min(limits.maxBytes, 512 * 1024),
          };
          let discard = Math.max(
            0,
            messages.reduce(
              (count, message) =>
                count +
                (message.role === "toolResult"
                  ? message.content.filter((part) => part.type === "image")
                      .length
                  : 0),
              0,
            ) - 2,
          );
          const output = [];
          for (const message of messages) {
            const removed =
              message.role === "toolResult"
                ? Math.min(
                    discard,
                    message.content.filter((part) => part.type === "image")
                      .length,
                  )
                : 0;
            discard -= removed;
            output.push(
              (message.role === "user" || message.role === "toolResult") &&
                Array.isArray(message.content)
                ? {
                    ...message,
                    content: [
                      ...(await normalize(
                        message.content,
                        message.role === "toolResult" ? toolLimits : limits,
                        removed,
                      )),
                    ],
                  }
                : message,
            );
          }
          return { messages: output };
        },
      }),
    ],
  });
}
