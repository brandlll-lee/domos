import type { Message } from "@earendil-works/pi-ai";
import {
  AgentDoc,
  type AgentState,
  type ConversationView,
  LiveDoc,
  type LiveState,
  type ModelRef,
} from "@earendil-works/pi-durable";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  stopped: boolean;
};

export type ChatView = {
  id: number;
  model: ModelRef | null;
  messages: ChatMessage[];
  busy: boolean;
  error: string | null;
};

function text(message: Message) {
  return typeof message.content === "string"
    ? message.content
    : message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
}

export function chatView(view: ConversationView): ChatView {
  const live = view.docs[LiveDoc.definition.kind] as LiveState | undefined;
  const agent = view.docs[AgentDoc.definition.kind] as AgentState | undefined;
  const messages: ChatMessage[] = [];
  let failed = false;
  const append = (message: Message, id: string) => {
    if (message.role !== "user" && message.role !== "assistant") return;
    failed = message.role === "assistant" && message.stopReason === "error";
    if (failed) return;
    messages.push({
      id,
      role: message.role,
      text: text(message),
      stopped: message.role === "assistant" && message.stopReason === "aborted",
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
    error:
      failed && !live?.run ? "回复失败。请检查模型配置、余额或网络。" : null,
  };
}
