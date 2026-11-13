import type { ChatMessage } from "@domos/agent/messages";
import { chatTranscript, type TranscriptItem } from "@domos/agent/transcript";
import type { ChatView } from "@domos/agent/view";

export function mergeChatMessages(
  previous: ChatMessage[],
  changed: ChatMessage[],
  removed: string[] = [],
): ChatMessage[] {
  const messages = new Map(previous.map((message) => [message.id, message]));
  for (const id of removed) messages.delete(id);
  for (const message of changed) messages.set(message.id, message);
  return [...messages.values()]
    .map((message) => ({
      message,
      position: message.cursor?.split(":").map(Number),
    }))
    .sort((a, b) => {
      if (!a.position) return b.position ? 1 : 0;
      if (!b.position) return -1;
      return (
        (a.position[0] ?? 0) - (b.position[0] ?? 0) ||
        (a.position[1] ?? 0) - (b.position[1] ?? 0)
      );
    })
    .map(({ message }) => message);
}

function sameFields(previous: object, next: object): boolean {
  const a = Object.entries(previous);
  const b = Object.entries(next);
  return (
    a.length === b.length &&
    b.every(([key, value]) => {
      const old = Reflect.get(previous, key);
      return (
        old === value ||
        (Array.isArray(old) &&
          Array.isArray(value) &&
          old.length === value.length &&
          value.every((item, index) => item === old[index]))
      );
    })
  );
}

export function transcriptState() {
  let items: TranscriptItem[] = [];
  let retained = new Map<string, TranscriptItem>();
  return (view: ChatView, outgoing: TranscriptItem[] = []) => {
    const next = new Map<string, TranscriptItem>();
    const history: TranscriptItem[] = [];
    for (const original of chatTranscript(view)) {
      const item =
        original.kind === "message" && original.message.requestId
          ? { ...original, id: original.message.requestId }
          : original;
      const key = `${item.kind}:${item.id}`;
      if (next.has(key)) continue;
      const previous = retained.get(key);
      const equal =
        previous?.kind === "message" && item.kind === "message"
          ? sameFields(previous.message, item.message)
          : previous && sameFields(previous, item);
      const row = equal && previous ? previous : item;
      next.set(key, row);
      history.push(row);
    }
    for (const item of outgoing) {
      const key = `${item.kind}:${item.id}`;
      if (next.has(key)) continue;
      next.set(key, item);
      history.push(item);
    }
    retained = next;
    if (
      history.length !== items.length ||
      history.some((item, index) => item !== items[index])
    )
      items = history;
    return { items };
  };
}
