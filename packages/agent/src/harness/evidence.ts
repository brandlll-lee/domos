import type { Context } from "@earendil-works/chord/context";
import type { Attachment } from "../attachments.ts";
import type { Files } from "../files.ts";
import type { ProductResult, ProductTool } from "./types.ts";

export async function computerEvidence(
  files: Files,
  botId: number,
  taskId: string,
  callId: string,
  tool: string,
  result: ProductResult,
  context: Context,
  outputSchema?: ProductTool["outputSchema"],
) {
  const source = result.structuredContent?.source as
    | { url?: string; capturedAt?: string }
    | undefined;
  const attachments: Attachment[] = [];
  let failed = false;
  for (const part of result.content) {
    if (part.type !== "image") continue;
    try {
      attachments.push(
        await files.capture(
          botId,
          Buffer.from(part.data, "base64"),
          {
            tool,
            taskId,
            callId,
            capturedAt: source?.capturedAt ?? new Date().toISOString(),
            ...(source?.url ? { url: source.url } : {}),
          },
          context,
        ),
      );
    } catch {
      failed = true;
    }
  }
  if (failed)
    result = {
      ...result,
      content: [
        ...result.content,
        {
          type: "text",
          text: "Screenshot evidence storage failed. The action result is preserved. Recover observation or storage only; do not repeat the action.",
        },
      ],
    };
  if (!attachments.length) return result;
  return {
    ...result,
    content: [
      ...result.content,
      {
        type: "text" as const,
        text: `Screenshots saved as task evidence. Use attach_file with an id only when you intend to send an image to the user.\n${JSON.stringify(attachments)}`,
      },
    ],
    ...(!outputSchema
      ? {
          structuredContent: {
            ...result.structuredContent,
            evidence: attachments,
          },
        }
      : {}),
  };
}
