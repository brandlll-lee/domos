import type { Context } from "@earendil-works/chord/context";
import type { Attachment } from "../attachments.ts";
import type { Files } from "../files.ts";
import type { ProductResult } from "./types.ts";

export async function computerEvidence(
  files: Files,
  botId: number,
  taskId: string,
  callId: string,
  tool: string,
  result: ProductResult,
  context: Context,
) {
  const source = result.structuredContent?.source as
    | { url?: string; capturedAt?: string }
    | undefined;
  const attachments: Attachment[] = [];
  for (const part of result.content) {
    if (part.type !== "image") continue;
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
  }
  return {
    attachments,
    result: attachments.length
      ? {
          ...result,
          structuredContent: {
            ...result.structuredContent,
            evidence: attachments,
          },
        }
      : result,
  };
}
