import { chatTranscript, type TranscriptItem } from "@domos/agent/transcript";
import type { ChatView } from "@domos/agent/view";

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
    let ordered = items.flatMap((item) => {
      const row = next.get(`${item.kind}:${item.id}`);
      return row ? [row] : [];
    });
    ordered.push(
      ...history.filter((item) => !retained.has(`${item.kind}:${item.id}`)),
    );
    const users = history.filter(
      (item) => item.kind === "message" && item.message.role === "user",
    );
    let userIndex = 0;
    if (
      ordered.some(
        (item) =>
          item.kind === "message" &&
          item.message.role === "user" &&
          item !== users[userIndex++],
      )
    )
      ordered = history;
    retained = next;
    if (
      ordered.length !== items.length ||
      ordered.some((item, index) => item !== items[index])
    )
      items = ordered;
    return { items };
  };
}
