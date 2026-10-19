import type { TranscriptItem } from "@domos/agent/transcript";

const clock = new Intl.DateTimeFormat(undefined, {
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
});
const day = new Intl.DateTimeFormat(undefined, {
  month: "long",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function clockTime(at: number) {
  return clock.format(at);
}

export function dayLabel(at: number) {
  return day.format(at);
}

export function messageDay(item: TranscriptItem) {
  if (item.kind !== "message") return undefined;
  const at = item.message.timestamp;
  if (at === undefined || !Number.isFinite(at)) return undefined;
  const date = new Date(at);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}
