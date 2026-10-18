import type {
  AssistantMessage,
  ImageContent,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "@earendil-works/pi-ai";
import type { ToolDiagnostic } from "@earendil-works/pi-durable";
import type { Attachment } from "./attachments.ts";
import type { MessageDelivery } from "./delivery.ts";

export type ChatContent =
  | Pick<TextContent, "type" | "text">
  | Pick<ThinkingContent, "type" | "thinking">
  | ImageContent
  | Pick<ToolCall, "type" | "id" | "name" | "arguments">;

export type ChatMessage = {
  id: string;
  turnId?: string;
  role: "user" | "assistant" | "toolResult";
  content: (ChatContent & { key: string })[];
  stopped: boolean;
  stopReason?: AssistantMessage["stopReason"];
  error?: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  attachments?: Attachment[];
  delivery?: MessageDelivery;
  toolStatus?: "pending" | "running" | "done" | "failed" | "stopped";
  diagnostics?: readonly ToolDiagnostic[];
};

export function messageText(message: {
  content: string | readonly ChatContent[];
}) {
  return typeof message.content === "string"
    ? message.content
    : message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
}
