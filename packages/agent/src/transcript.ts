import type { Attachment } from "./attachments.ts";
import type { ChatView } from "./chat-view.ts";
import type { ChatContent, ChatMessage } from "./messages.ts";

export type ActivityStatus = "running" | "done" | "failed" | "stopped";
export type ToolStatus = ActivityStatus | "pending" | "waiting";
export type ActivityStep =
  | { type: "text" | "thinking"; id: string; text: string }
  | {
      type: "tool";
      id: string;
      name: string;
      arguments: Record<string, unknown>;
      status: ToolStatus;
      output: ChatMessage["content"];
      liveOutput?: string;
    };

export type Activity = {
  kind: "activity";
  id: string;
  status: ActivityStatus;
  responding: boolean;
  steps: ActivityStep[];
};

export type TranscriptItem =
  | Activity
  | { kind: "message"; id: string; message: ChatMessage }
  | { kind: "attachments"; id: string; files: Attachment[] };

export function chatTranscript(view: ChatView): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const activities = new Map<string, Activity>();
  const results = new Map(
    view.messages.flatMap((message) =>
      message.role === "toolResult" && message.toolCallId
        ? [[`${message.turnId}:${message.toolCallId}`, message] as const]
        : [],
    ),
  );
  const activity = (id: string) => {
    let value = activities.get(id);
    if (!value) {
      value = {
        kind: "activity",
        id,
        status: "done",
        responding: false,
        steps: [],
      };
      activities.set(id, value);
      items.push(value);
    }
    return value;
  };
  for (const message of view.messages) {
    if (message.role === "user") {
      items.push({ kind: "message", id: message.id, message });
      continue;
    }
    const groupId = message.turnId ?? message.id;
    const active = groupId === view.activeTurnId;
    if (message.role === "toolResult") {
      if (message.attachments?.length)
        items.push({
          kind: "attachments",
          id: message.id,
          files: message.attachments,
        });
      continue;
    }
    if (active) activity(groupId);
    const progress =
      message.stopReason === "toolUse" ||
      message.stopped ||
      message.content.some((part) => part.type === "toolCall");
    const content: ChatMessage["content"] = [];
    for (const part of message.content) {
      if (part.type === "thinking") {
        if (part.thinking)
          activity(groupId).steps.push({
            type: "thinking",
            id: part.key,
            text: part.thinking,
          });
      } else if (part.type === "text" && progress) {
        if (part.text)
          activity(groupId).steps.push({
            type: "text",
            id: part.key,
            text: part.text,
          });
      } else if (part.type === "toolCall") {
        const result = results.get(`${message.turnId}:${part.id}`);
        const live = active
          ? view.tools.find((tool) => tool.callId === part.id)
          : undefined;
        activity(groupId).steps.push({
          type: "tool",
          id: part.id,
          name: part.name,
          arguments: part.arguments,
          status: result?.toolStatus ?? live?.status ?? "waiting",
          output: result?.content ?? [],
          liveOutput: live?.output,
        });
      } else if (visibleContent(part)) {
        content.push(part);
      }
    }
    if (message.stopped) activity(groupId).status = "stopped";
    if (active && content.length) activity(groupId).responding = true;
    if (content.length || message.attachments?.length)
      items.push({
        kind: "message",
        id: message.id,
        message: { ...message, content },
      });
  }
  if (view.activeTurnId) activity(view.activeTurnId).status = "running";
  const lastTurnId = view.messages.findLast(
    (message) => message.role === "user",
  )?.turnId;
  for (const value of activities.values()) {
    if (value.status === "running") continue;
    if (
      value.steps.some(
        (step) => step.type === "tool" && step.status === "stopped",
      )
    )
      value.status = "stopped";
    else if (
      value.steps.some(
        (step) => step.type === "tool" && step.status === "failed",
      ) ||
      (view.failed && value.id === lastTurnId)
    )
      value.status = "failed";
  }
  return items.filter(
    (item) =>
      item.kind !== "activity" || item.steps.length || item.status !== "done",
  );
}

function visibleContent(part: ChatContent) {
  return (
    part.type === "image" || (part.type === "text" && part.text.length > 0)
  );
}
