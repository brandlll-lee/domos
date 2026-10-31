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
import { EngineMessage } from "./harness/state.ts";
import type {
  EngineApproval,
  EngineConfig,
  EngineRun,
  EngineRuntimeState,
} from "./harness/types.ts";
import {
  approvalMessage,
  type ChatMessage,
  type MessageDelivery,
} from "./messages.ts";
import { modelFailure } from "./runtime/model-diagnostics.ts";
import { RoutineInput } from "./work/routine-state.ts";

export type ChatView = {
  before?: string;
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
  runs?: EngineRun[];
  error?: string | null;
  tools: {
    callId: string;
    status: "pending" | "running" | "done";
    output?: string;
  }[];
};

export function chatView(
  view: Omit<ConversationView, "conversation"> & {
    conversation: Pick<ConversationView["conversation"], "id">;
  },
  approvals: EngineApproval[] = [],
): ChatView {
  const live = view.docs[LiveDoc.definition.kind] as LiveState | undefined;
  const agent = view.docs[AgentDoc.definition.kind] as AgentState | undefined;
  const messages: ChatMessage[] = [];
  const runs: EngineRun[] = [];
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
    const assistant = message.role === "assistant" ? message : null;
    const tool = message.role === "toolResult" ? message : null;
    const failure = assistant?.stopReason === "error";
    const parts =
      text !== undefined
        ? [{ type: "text" as const, text }]
        : typeof message.content === "string"
          ? [{ type: "text" as const, text: message.content }]
          : message.content.filter(
              (part) => part.type !== "thinking" || !part.redacted,
            );
    return {
      id,
      turnId,
      role: message.role,
      timestamp: message.timestamp,
      attachments,
      ...(assistant ? { stopReason: assistant.stopReason } : {}),
      content: failure
        ? []
        : parts.map((part, index) => ({
            ...(part.type === "text"
              ? { type: part.type, text: part.text }
              : part.type === "thinking"
                ? { type: part.type, thinking: part.thinking }
                : part.type === "image"
                  ? {
                      type: part.type,
                      data: part.data,
                      mimeType: part.mimeType,
                    }
                  : {
                      type: part.type,
                      id: part.id,
                      name: part.name,
                      arguments: part.arguments,
                    }),
            key: `${id}:${index}`,
          })),
      ...(failure && assistant ? { error: modelFailure(assistant, id) } : {}),
      stopped: assistant?.stopReason === "aborted",
      ...(tool
        ? {
            toolCallId: tool.toolCallId,
            toolName: tool.toolName,
            isError: tool.isError,
            diagnostics,
            toolStatus: stopped ? "stopped" : tool.isError ? "failed" : "done",
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
    if (entry.kind === "domos.engine-run") {
      runs.push(entry.data as unknown as EngineRun);
      continue;
    }
    if (entry.kind === EngineMessage) {
      const message = entry.data as unknown as ChatMessage;
      if (message.role === "user") turnId = message.turnId;
      messages.push({ ...message, cursor: `${entry.id}:0` });
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
          cursor: `${entry.id}:${index}`,
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
    messages.push({ ...approvalMessage(approval, "pending"), turnId });
  }
  return {
    id: view.conversation.id,
    model: agent?.model ?? null,
    instructions: agent?.instructions ?? "",
    messages,
    runs,
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
