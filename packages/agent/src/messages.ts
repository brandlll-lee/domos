import type {
  AssistantMessage,
  ImageContent,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "@earendil-works/pi-ai";
import type { ToolDiagnostic } from "@earendil-works/pi-durable";
import type { Attachment } from "./attachments.ts";
import type { EngineAnswer, EngineApproval } from "./harness/types.ts";
import type { InputMaterials } from "./materials.ts";

export type MessageDelivery = { text: string; kind?: "update" | "question" };

export type LinkCard = {
  url: string;
  label: string;
  body: string;
  title?: string;
  footer?: string;
};

export type ChatContent =
  | Pick<TextContent, "type" | "text">
  | Pick<ThinkingContent, "type" | "thinking">
  | ImageContent
  | Pick<ToolCall, "type" | "id" | "name" | "arguments">;

export type ChatMessage = {
  reply?: {
    id: string;
    title: string;
    cursor?: string;
    attachments?: Attachment[];
  };
  link?: LinkCard;
  sessionId?: number;
  author?: { botId: number; name: string; avatar: string };
  collaboration?: { id: string; recipient: number };
  notice?: { text: string };
  cursor?: string;
  routine?: {
    runId: string;
    title: string;
    scheduledAt: number;
    turnId?: string;
    delivery?: "always" | "conditional";
  };
  hidden?: boolean;
  detail?: boolean;
  activity?: import("./harness/types.ts").EngineEvent;
  receivedAt?: number;
  updatedAt?: number;
  endedAt?: number;
  native?: Record<string, unknown>;
  parentId?: string;
  approval?: {
    request: EngineApproval;
    state: "pending" | "answered" | "denied" | "expired";
    answer?: EngineAnswer;
  };
  takeover?: {
    id: string;
    service: "browser" | "desktop";
    computerId: string;
    revision: number;
    state: "waiting" | "controlling" | "done" | "cancelled" | "expired";
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

export function approvalMessage(
  request: EngineApproval,
  state: NonNullable<ChatMessage["approval"]>["state"],
  answer?: EngineAnswer,
): ChatMessage {
  const attachments = [
    ...new Map(
      [
        ...(request.attachments ?? []),
        ...(request.questions ?? []).flatMap((question) =>
          (question.options ?? []).flatMap(
            (option) => option.attachments ?? [],
          ),
        ),
      ].map((file) => [file.id, file]),
    ).values(),
  ];
  return {
    id: `approval:${request.id}:${request.requestedAt ?? 0}`,
    role: "assistant",
    content: request.takeover
      ? [
          { type: "text", text: request.detail, key: request.id },
          ...(request.preview
            ? [{ ...request.preview, key: `${request.id}:preview` }]
            : []),
        ]
      : [],
    timestamp: request.requestedAt,
    ...(attachments.length ? { attachments } : {}),
    pending: state === "pending",
    stopped: state === "expired",
    ...(request.takeover
      ? {
          takeover: {
            ...request.takeover,
            state:
              state === "pending"
                ? request.takeover.state
                : state === "answered"
                  ? "done"
                  : state === "denied"
                    ? "cancelled"
                    : "expired",
          },
        }
      : { approval: { request, state, ...(answer ? { answer } : {}) } }),
  };
}

export function messageText(message: {
  content: string | readonly ChatContent[];
  link?: LinkCard;
  approval?: ChatMessage["approval"];
}) {
  if (message.approval?.request.kind === "question") {
    const request = message.approval.request;
    return [
      ...new Set([
        request.title,
        request.detail,
        ...(request.questions ?? []).flatMap((question) => [
          question.title,
          ...(question.options ?? []).map((option) => option.label),
        ]),
      ]),
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (message.link)
    return [
      message.link.title,
      message.link.body,
      message.link.label,
      message.link.url,
    ]
      .filter(Boolean)
      .join("\n");
  return typeof message.content === "string"
    ? message.content
    : message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
}
