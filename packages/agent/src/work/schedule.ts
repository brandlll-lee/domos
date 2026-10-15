import { Cron } from "croner";
import { WorkError } from "./state.ts";

export type Schedule =
  | { type: "once"; at: string; timeZone: string }
  | { type: "cron"; expression: string; timeZone: string };

const MAX_FOLD_CANDIDATES = 1441;

export function validateSchedule(schedule: Schedule, now: number) {
  if (
    !/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(schedule.timeZone)
  )
    throw new WorkError("BAD_REQUEST", "请使用IANA时区名称。");
  if (schedule.type === "once" && !/(?:Z|[+-]\d{2}:\d{2})$/.test(schedule.at))
    throw new WorkError("BAD_REQUEST", "执行时间须包含明确时区偏移。");
  try {
    new Intl.DateTimeFormat("en", { timeZone: schedule.timeZone }).format(0);
  } catch {
    throw new WorkError(
      "BAD_REQUEST",
      "时区无效。请使用Asia/Shanghai等IANA时区。",
    );
  }
  if (nextScheduled(schedule, now) === null)
    throw new WorkError("BAD_REQUEST", "计划没有未来执行时间。");
  return schedule;
}

export function nextScheduled(
  schedule: Schedule,
  after: number,
): number | null {
  if (schedule.type === "once") {
    const at = Date.parse(schedule.at);
    return Number.isFinite(at) && at > after ? at : null;
  }
  const expression = schedule.expression.trim().replace(/\s+/g, " ");
  if (expression.split(" ").length !== 5)
    throw new WorkError(
      "BAD_REQUEST",
      "Cron需要分钟、小时、日、月、星期五个字段。",
    );
  let cron: Cron;
  try {
    cron = new Cron(expression, {
      timezone: schedule.timeZone,
      mode: "5-part",
      paused: true,
    });
  } catch {
    throw new WorkError("BAD_REQUEST", "Cron表达式无效。");
  }
  let count = 1;
  while (true) {
    const dates = cron.nextRuns(count, new Date(after));
    const future = dates.find((date) => date.getTime() > after);
    if (future) return future.getTime();
    if (dates.length < count || count === MAX_FOLD_CANDIDATES) return null;
    count = Math.min(MAX_FOLD_CANDIDATES, count * 2);
  }
}
