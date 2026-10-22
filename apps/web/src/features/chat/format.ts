const clock = new Intl.DateTimeFormat("zh-CN", {
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
});
const shortDate = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
});
const longDate = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
});
const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "short" });
const TIME_BREAK_MS = 5 * 60_000;

export function clockTime(at: number) {
  return clock.format(at);
}

function startOfDay(at: number) {
  const date = new Date(at);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

function dayDifference(from: number, to: number) {
  return Math.round((startOfDay(to) - startOfDay(from)) / 86_400_000);
}

export function timeBreak(
  previousAt: number | undefined,
  currentAt: number | undefined,
  now = Date.now(),
) {
  if (currentAt === undefined || !Number.isFinite(currentAt)) return null;
  if (previousAt !== undefined && Number.isFinite(previousAt)) {
    const sameDay = dayDifference(previousAt, currentAt) === 0;
    if (sameDay && currentAt - previousAt < TIME_BREAK_MS) return null;
  }
  const time = clockTime(currentAt);
  const age = dayDifference(currentAt, now);
  if (age <= 0) return `今天 ${time}`;
  if (age === 1) return `昨天 ${time}`;
  const date = new Date(currentAt);
  const dateLabel =
    date.getFullYear() === new Date(now).getFullYear()
      ? shortDate.format(date)
      : longDate.format(date);
  return `${dateLabel} ${weekday.format(date)} ${time}`;
}

export function contactTime(at: number, now = Date.now()) {
  const age = dayDifference(at, now);
  if (age <= 0) return clockTime(at);
  if (age === 1) return "昨天";
  if (age < 7) return weekday.format(at);
  return longDate.format(at);
}
