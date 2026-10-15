import type {
  ImageContent,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "@earendil-works/pi-ai";

export type ChatContent =
  | Pick<TextContent, "type" | "text">
  | Pick<ThinkingContent, "type" | "thinking">
  | ImageContent
  | Pick<ToolCall, "type" | "id" | "name" | "arguments">;

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "toolResult";
  content: (ChatContent & { key: string })[];
  stopped: boolean;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
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
