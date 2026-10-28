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
import type { MessageDelivery } from "./delivery.ts";
import { FileInput } from "./files.ts";
import { EngineMessage } from "./harness/state.ts";
import type {
  EngineApproval,
  EngineConfig,
  EngineRuntimeState,
} from "./harness/types.ts";
import type { ChatContent, ChatMessage } from "./messages.ts";
import { modelFailure } from "./runtime/model-diagnostics.ts";
import { RoutineInput } from "./work/routine-state.ts";

export type ChatView = {
  id: number;
  model: ModelRef | null;
  instructions: string;
  messages: ChatMessage[];
  draft: ChatMessage | null;
  activeTurnId: string | null;
  busy: boolean;
  processing?: boolean;
  failed: boolean;
  engine?: EngineConfig;
  approvals?: EngineApproval[];
  runtime?: EngineRuntimeState;
  error?: string | null;
  tools: {
    callId: string;
    status: "pending" | "running" | "done";
    output?: string;
  }[];
};

export function chatView(
  view: ConversationView,
  approvals: EngineApproval[] = [],
): ChatView {
  const live = view.docs[LiveDoc.definition.kind] as LiveState | undefined;
  const agent = view.docs[AgentDoc.definition.kind] as AgentState | undefined;
  const messages: ChatMessage[] = [];
  const lastAttempts = new Map<number, number>();
  for (const entry of view.entries)
    if (
      entry.byTaskId &&
      entry.model?.some((message) => message.role === "assistant")
    )
      lastAttempts.set(entry.byTaskId, entry.id);
  let turnId: string | undefined;
  let failed = false;
  const project = (
    message: Message,
    id: string,
    attachments?: Attachment[],
    text?: string,
    stopped = false,
    diagnostics?: ChatMessage["diagnostics"],
  ): ChatMessage | null => {
    if (message.role === "system") return null;
    if (message.role === "user") turnId = id;
    const failure =
      message.role === "assistant" && message.stopReason === "error";
    return {
      id,
      turnId,
      role: message.role,
      timestamp: message.timestamp,
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
                    {
                      type: "image",
                      data: part.data,
                      mimeType: part.mimeType,
                    },
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
      ...(failure ? { content: [], error: modelFailure(message, id) } : {}),
      stopped: message.role === "assistant" && message.stopReason === "aborted",
      ...(message.role === "toolResult"
        ? {
            toolCallId: message.toolCallId,
            toolName: message.toolName,
            isError: message.isError,
            diagnostics,
            toolStatus: stopped
              ? "stopped"
              : message.isError
                ? "failed"
                : "done",
          }
        : {}),
    };
  };
  for (const entry of view.entries) {
    if (
      ["domos.context-history", "pi.compaction", "pi.reset"].includes(
        entry.kind,
      )
    )
      continue;
    if (entry.kind === EngineMessage) {
      const message = entry.data as unknown as ChatMessage;
      if (message.role === "user") turnId = message.turnId;
      messages.push(message);
      continue;
    }
    const input =
      entry.kind === FileInput || entry.kind === RoutineInput
        ? (entry.data as {
            text: string;
            attachments?: Attachment[];
            materials?: ChatMessage["materials"];
            requestId?: string;
          })
        : undefined;
    const diagnostics =
      entry.kind === "pi.tool-result"
        ? (
            entry.data as
              | { diagnostics?: ChatMessage["diagnostics"] }
              | undefined
          )?.diagnostics
        : undefined;
    const stopped = diagnostics?.some((item) => item.code === "aborted");
    entry.model?.forEach((message, index) => {
      if (
        message.role === "assistant" &&
        message.stopReason === "error" &&
        entry.byTaskId &&
        (lastAttempts.get(entry.byTaskId) !== entry.id ||
          entry.byTaskId === live?.run?.taskId)
      )
        return;
      const attachment =
        message.role === "toolResult"
          ? (message.details as { attachment?: Attachment } | undefined)
              ?.attachment
          : undefined;
      const delivery =
        message.role === "toolResult" && !message.isError && !stopped
          ? (message.details as { delivery?: MessageDelivery } | undefined)
              ?.delivery
          : undefined;
      failed = message.role === "assistant" && message.stopReason === "error";
      const projected = project(
        message,
        `${entry.id}:${index}`,
        input?.attachments ?? (attachment ? [attachment] : undefined),
        input?.text,
        stopped,
        diagnostics,
      );
      if (projected)
        messages.push({
          ...projected,
          ...(projected.role === "user" && input?.requestId
            ? { requestId: input.requestId }
            : {}),
          ...(projected.role === "user" && input?.materials
            ? { materials: input.materials }
            : {}),
          ...(delivery ? { delivery } : {}),
        });
    });
  }
  const draft = live?.generation?.message
    ? project(live.generation.message, "draft")
    : null;
  for (const approval of approvals) {
    if (approval.takeover)
      messages.push({
        id: approval.id,
        turnId,
        role: "assistant",
        content: [
          { type: "text", text: approval.detail, key: approval.id },
          ...(approval.preview
            ? [{ ...approval.preview, key: `${approval.id}:preview` }]
            : []),
        ],
        takeover: approval.takeover,
        pending: true,
        stopped: false,
      });
  }
  return {
    id: view.conversation.id,
    model: agent?.model ?? null,
    instructions: agent?.instructions ?? "",
    messages,
    draft,
    activeTurnId: live?.run ? (turnId ?? null) : null,
    busy: Boolean(live?.run),
    processing: Boolean(
      live?.run &&
        !approvals.length &&
        (live.generation || live.tools?.some((tool) => tool.status !== "done")),
    ),
    failed: failed && !live?.run,
    approvals: approvals,
    tools:
      live?.tools?.map(({ callId, status, output }) => ({
        callId,
        status,
        ...(output ? { output } : {}),
      })) ?? [],
  };
}
