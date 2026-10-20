import type { Attachment } from "./attachments.ts";
import type { ChatView } from "./chat-view.ts";
import type { ChatMessage } from "./messages.ts";

export type TaskNotice = {
  kind: "notice";
  id: string;
  status: "failed";
  error?: string;
};

export type TranscriptItem =
  | TaskNotice
  | { kind: "message"; id: string; message: ChatMessage }
  | { kind: "attachments"; id: string; files: Attachment[] };

export function chatTranscript(view: ChatView): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const notices = new Map<string, TaskNotice>();
  const interrupted = new Set<string>();
  const ends = new Map<string, number>();
  const lastTurn = view.messages.findLast(
    (message) => message.role === "user",
  )?.turnId;
  view.messages.forEach((message, index) => {
    const id = message.turnId ?? message.id;
    ends.set(id, index);
    if (message.role !== "assistant") return;
    if (message.stopped) interrupted.add(id);
    if (message.stopReason === "error")
      notices.set(id, {
        kind: "notice",
        id,
        status: "failed",
        ...(message.error ? { error: message.error } : {}),
      });
  });
  if (view.failed && !view.busy && lastTurn && !interrupted.has(lastTurn)) {
    const error = view.error ?? notices.get(lastTurn)?.error;
    notices.set(lastTurn, {
      kind: "notice",
      id: lastTurn,
      status: "failed",
      ...(error ? { error } : {}),
    });
  }
  let attachmentTurn: string | undefined;
  view.messages.forEach((message, index) => {
    const id = message.turnId ?? message.id;
    const held =
      id === view.activeTurnId || notices.has(id) || interrupted.has(id);
    if (message.role === "user")
      items.push({ kind: "message", id: message.id, message });
    else if (message.role === "toolResult") {
      if (message.delivery)
        items.push({
          kind: "message",
          id: message.id,
          message: {
            id: message.id,
            turnId: message.turnId,
            role: "assistant",
            content: [
              {
                type: "text",
                text: message.delivery.text,
                key: `${message.id}:delivery`,
              },
            ],
            stopped: false,
          },
        });
      if (!held && message.attachments?.length) {
        const previous = items.at(-1);
        if (previous?.kind === "attachments" && attachmentTurn === id)
          previous.files.push(...message.attachments);
        else
          items.push({
            kind: "attachments",
            id: message.id,
            files: [...message.attachments],
          });
        attachmentTurn = id;
      }
    } else if (
      !message.pending &&
      !message.stopped &&
      message.stopReason !== "error"
    ) {
      const content = message.content.filter(
        (part) =>
          part.type === "image" ||
          (part.type === "text" && part.text.length > 0),
      );
      const attachments = held ? undefined : message.attachments;
      if (content.length || attachments?.length)
        items.push({
          kind: "message",
          id: message.id,
          message: { ...message, content, attachments },
        });
    }
    const notice = notices.get(id);
    if (notice && index === ends.get(id)) items.push(notice);
  });
  return items;
}
