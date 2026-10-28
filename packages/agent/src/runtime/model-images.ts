import type { Context } from "@earendil-works/chord/context";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import {
  AgentDoc,
  defineExtension,
  GenerationTask,
  type HookApi,
  hook,
} from "@earendil-works/pi-durable";
import {
  DEFAULT_IMAGE_LIMITS,
  type ImageProcessor,
} from "@earendil-works/pi-durable/tools";

export function modelImages(images: ImageProcessor) {
  async function normalize(
    content: readonly (TextContent | ImageContent)[],
    api: HookApi,
    context: Context,
  ) {
    if (!content.some((part) => part.type === "image")) return content;
    const agent = await api.snapshot(AgentDoc, api.conversationId, context);
    const ref = agent?.model;
    const model = ref && api.models.getModel(ref.provider, ref.modelId);
    const limits = {
      ...DEFAULT_IMAGE_LIMITS,
      ...model?.inputLimits?.images?.resize,
    };
    const output: (TextContent | ImageContent)[] = [];
    for (const part of content) {
      if (part.type !== "image") {
        output.push(part);
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
          const output = [];
          for (const message of messages) {
            output.push(
              (message.role === "user" || message.role === "toolResult") &&
                Array.isArray(message.content)
                ? {
                    ...message,
                    content: [
                      ...(await normalize(message.content, api, context)),
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
