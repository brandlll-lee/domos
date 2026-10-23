import { chatTranscript, type TranscriptItem } from "@domos/agent/transcript";
import type { ChatView } from "@domos/agent/view";

export function transcriptState() {
  let items: TranscriptItem[] = [];
  let retained = new Map<string, { item: TranscriptItem; value: string }>();
  return (view: ChatView, outgoing: TranscriptItem[] = []) => {
    const next = new Map<string, { item: TranscriptItem; value: string }>();
    const history: TranscriptItem[] = [];
    for (const original of chatTranscript(view)) {
      const item =
        original.kind === "message" && original.message.requestId
          ? { ...original, id: original.message.requestId }
          : original;
      const key = `${item.kind}:${item.id}`;
      const value = JSON.stringify(item);
      const previous = retained.get(key);
      const row = previous?.value === value ? previous.item : item;
      next.set(key, { item: row, value });
      history.push(row);
    }
    for (const item of outgoing) {
      const key = `${item.kind}:${item.id}`;
      if (next.has(key)) continue;
      next.set(key, { item, value: JSON.stringify(item) });
      history.push(item);
    }
    const ordered = items.flatMap((item) => {
      const row = next.get(`${item.kind}:${item.id}`);
      return row ? [row.item] : [];
    });
    ordered.push(
      ...history.filter((item) => !retained.has(`${item.kind}:${item.id}`)),
    );
    retained = next;
    if (
      ordered.length !== items.length ||
      ordered.some((item, index) => item !== items[index])
    )
      items = ordered;
    return { items };
  };
}
