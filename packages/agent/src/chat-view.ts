import type { Message } from "@earendil-works/pi-ai";
import {
  AgentDoc,
  type AgentState,
  type ConversationView,
  LiveDoc,
  type LiveState,
  type ModelRef,
} from "@earendil-works/pi-durable";
import type { ChatContent, ChatMessage } from "./messages.ts";

export type ChatView = {
  id: number;
  model: ModelRef | null;
  messages: ChatMessage[];
  busy: boolean;
  failed: boolean;
};

export function chatView(view: ConversationView): ChatView {
  const live = view.docs[LiveDoc.definition.kind] as LiveState | undefined;
  const agent = view.docs[AgentDoc.definition.kind] as AgentState | undefined;
  const messages: ChatMessage[] = [];
  let failed = false;
  const append = (message: Message, id: string) => {
    if (message.role === "system") return;
    failed = message.role === "assistant" && message.stopReason === "error";
    if (failed) return;
    messages.push({
      id,
      role: message.role,
      content: (typeof message.content === "string"
        ? [{ type: "text" as const, text: message.content }]
        : message.content.flatMap((part): ChatContent[] => {
            switch (part.type) {
              case "text":
                return [{ type: "text", text: part.text }];
              case "thinking":
                return part.redacted
                  ? []
                  : [{ type: "thinking", thinking: part.thinking }];
              case "image":
                return [
                  { type: "image", data: part.data, mimeType: part.mimeType },
                ];
              case "toolCall":
                return [
                  {
                    type: "toolCall",
                    id: part.id,
                    name: part.name,
                    arguments: part.arguments,
                  },
                ];
            }
            const exhaustive: never = part;
            return exhaustive;
          })
      ).map((part, index) => ({ ...part, key: `${id}:${index}` })),
      stopped: message.role === "assistant" && message.stopReason === "aborted",
      ...(message.role === "toolResult"
        ? {
            toolCallId: message.toolCallId,
            toolName: message.toolName,
            isError: message.isError,
          }
        : {}),
    });
  };
  for (const entry of view.entries) {
    entry.model?.forEach((message, index) => {
      append(message, `${entry.id}:${index}`);
    });
  }
  if (live?.generation?.message) append(live.generation.message, "stream");
  return {
    id: view.conversation.id,
    model: agent?.model ?? null,
    messages,
    busy: Boolean(live?.run),
    failed: failed && !live?.run,
  };
}
