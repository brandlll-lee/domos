import type {
  AssistantMessage,
  ImageContent,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "@earendil-works/pi-ai";
import type { ToolDiagnostic } from "@earendil-works/pi-durable";
import type { Attachment } from "./attachments.ts";
import type { InputMaterials } from "./materials.ts";

export type MessageDelivery = { text: string; kind?: "update" | "question" };

export type ChatContent =
  | Pick<TextContent, "type" | "text">
  | Pick<ThinkingContent, "type" | "thinking">
  | ImageContent
  | Pick<ToolCall, "type" | "id" | "name" | "arguments">;

export type ChatMessage = {
  cursor?: string;
  detail?: boolean;
  activity?: import("./harness/types.ts").EngineEvent;
  receivedAt?: number;
  endedAt?: number;
  takeover?: {
    id: string;
    service: "browser" | "desktop";
    computerId: string;
    revision: number;
    state: "waiting" | "done" | "expired";
    url?: string;
  };
  id: string;
  turnId?: string;
  requestId?: string;
  role: "user" | "assistant" | "toolResult";
  content: (ChatContent & { key: string })[];
  stopped: boolean;
  timestamp?: number;
  pending?: boolean;
  stopReason?: AssistantMessage["stopReason"];
  error?: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  attachments?: Attachment[];
  materials?: InputMaterials;
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
