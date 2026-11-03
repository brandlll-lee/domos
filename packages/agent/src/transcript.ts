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
    if (message.hidden || (message.role === "user" && message.routine)) return;
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
  const delivered = new Set<string>();
  const attached = new Set(
    view.messages.flatMap((message) =>
      message.role === "assistant" && !message.pending && !message.stopped
        ? (message.attachments ?? []).map(
            (file) => `${message.turnId ?? message.id}:${file.id}`,
          )
        : [],
    ),
  );
  const filesFor = (message: ChatMessage) =>
    message.attachments?.filter((file) => {
      const key = `${message.turnId ?? message.id}:${file.id}`;
      if (
        delivered.has(key) ||
        (message.role === "toolResult" && attached.has(key))
      )
        return false;
      delivered.add(key);
      return true;
    });
  view.messages.forEach((message, index) => {
    if (message.hidden || (message.role === "user" && message.routine)) return;
    const id = message.turnId ?? message.id;
    const held =
      id === view.activeTurnId || notices.has(id) || interrupted.has(id);
    if (message.role === "user")
      items.push({ kind: "message", id: message.id, message });
    else if (message.role === "toolResult") {
      if (message.notice && !message.isError)
        items.push({
          kind: "message",
          id: message.id,
          message: { ...message, role: "assistant", content: [] },
        });
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
      const files = !held ? filesFor(message) : undefined;
      if (files?.length) {
        const previous = items.at(-1);
        if (previous?.kind === "attachments" && attachmentTurn === id)
          previous.files.push(...files);
        else
          items.push({
            kind: "attachments",
            id: message.id,
            files,
          });
        attachmentTurn = id;
      }
    } else if (
      !message.parentId &&
      (message.takeover ||
        message.approval ||
        (!message.pending &&
          !message.stopped &&
          message.stopReason !== "error"))
    ) {
      const content = message.content.filter(
        (part) =>
          part.type === "image" ||
          (part.type === "text" && part.text.trim().length > 0),
      );
      const attachments = held ? undefined : filesFor(message);
      if (
        message.approval ||
        message.takeover ||
        content.length ||
        attachments?.length
      )
        items.push({
          kind: "message",
          id: message.id,
          message: { ...message, content, attachments },
        });
    }
    const notice = notices.get(id);
    if (notice && index === ends.get(id)) items.push(notice);
  });
  for (const card of items.filter(
    (item) =>
      item.kind === "message" &&
      (item.message.approval || item.message.takeover),
  )) {
    if (card.kind !== "message" || card.message.timestamp === undefined)
      continue;
    const at = card.message.timestamp;
    items.splice(items.indexOf(card), 1);
    const index = items.findIndex(
      (item) =>
        item.kind === "message" &&
        (item.message.receivedAt ?? item.message.timestamp ?? 0) > at,
    );
    items.splice(index < 0 ? items.length : index, 0, card);
  }
  return items;
}
