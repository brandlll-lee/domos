import type { Message } from "@earendil-works/pi-ai";
import {
  AgentDoc,
  type AgentState,
  type ConversationView,
  LiveDoc,
  type LiveState,
  type ModelRef,
} from "@earendil-works/pi-durable";
import type { Attachment } from "./attachments.ts";
import { FileInput } from "./files.ts";
import type { ChatContent, ChatMessage } from "./messages.ts";

export type ChatView = {
  id: number;
  model: ModelRef | null;
  instructions: string;
  messages: ChatMessage[];
  activeTurnId: string | null;
  busy: boolean;
  failed: boolean;
  tools: {
    callId: string;
    status: "pending" | "running" | "done";
    output?: string;
  }[];
};

export function chatView(view: ConversationView): ChatView {
  const live = view.docs[LiveDoc.definition.kind] as LiveState | undefined;
  const agent = view.docs[AgentDoc.definition.kind] as AgentState | undefined;
  const messages: ChatMessage[] = [];
  let turnId: string | undefined;
  let failed = false;
  const append = (
    message: Message,
    id: string,
    attachments?: Attachment[],
    text?: string,
    stopped = false,
  ) => {
    if (message.role === "system") return;
    if (message.role === "user") turnId = id;
    failed = message.role === "assistant" && message.stopReason === "error";
    if (failed) return;
    messages.push({
      id,
      turnId,
      role: message.role,
      ...(message.role === "assistant"
        ? { stopReason: message.stopReason }
        : {}),
      attachments,
      content: (text !== undefined
        ? [{ type: "text" as const, text }]
        : typeof message.content === "string"
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
            toolStatus: stopped
              ? "stopped"
              : message.isError
                ? "failed"
                : "done",
          }
        : {}),
    });
  };
  for (const entry of view.entries) {
    const input =
      entry.kind === FileInput
        ? (entry.data as { text: string; attachments: Attachment[] })
        : undefined;
    const stopped =
      entry.kind === "pi.tool-result" &&
      (
        entry.data as { diagnostics?: { code?: string }[] } | undefined
      )?.diagnostics?.some((item) => item.code === "aborted");
    entry.model?.forEach((message, index) => {
      const attachment =
        message.role === "toolResult"
          ? (message.details as { attachment?: Attachment } | undefined)
              ?.attachment
          : undefined;
      append(
        message,
        `${entry.id}:${index}`,
        input?.attachments ?? (attachment ? [attachment] : undefined),
        input?.text,
        stopped,
      );
    });
  }
  if (live?.generation?.message) append(live.generation.message, "stream");
  return {
    id: view.conversation.id,
    model: agent?.model ?? null,
    instructions: agent?.instructions ?? "",
    messages,
    activeTurnId: live?.run ? (turnId ?? null) : null,
    busy: Boolean(live?.run),
    failed: failed && !live?.run,
    tools:
      live?.tools?.map(({ callId, status, output }) => ({
        callId,
        status,
        ...(output ? { output } : {}),
      })) ?? [],
  };
}
