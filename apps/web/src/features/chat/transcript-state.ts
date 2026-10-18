import {
  type Activity,
  chatTranscript,
  type TranscriptItem,
} from "@domos/agent/transcript";
import type { ChatView } from "@domos/agent/view";

export function transcriptState() {
  let items: TranscriptItem[] = [];
  let retained = new Map<string, { item: TranscriptItem; value: string }>();
  return (view: ChatView) => {
    const next = new Map<string, { item: TranscriptItem; value: string }>();
    const history: TranscriptItem[] = [];
    let active: Activity | undefined;
    for (const item of chatTranscript(view)) {
      const key = `${item.kind}:${item.id}`;
      const value = JSON.stringify(item);
      const previous = retained.get(key);
      const row = previous?.value === value ? previous.item : item;
      next.set(key, { item: row, value });
      if (row.kind === "activity" && row.status === "running") active = row;
      else history.push(row);
    }
    retained = next;
    if (
      history.length !== items.length ||
      history.some((item, index) => item !== items[index])
    )
      items = history;
    return { items, active };
  };
}
