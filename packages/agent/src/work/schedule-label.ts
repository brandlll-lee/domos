export const days = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
export const expressionPattern = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|[0-6])$/;

export function routineTimeLabel(expression: string) {
  const match = expressionPattern.exec(expression);
  if (!match) return expression;
  const [, minute = "0", hour = "9", weekday = "*"] = match;
  const frequency =
    weekday === "*"
      ? "每天"
      : weekday === "1-5"
        ? "工作日"
        : `每${days[Number(weekday)]}`;
  return `${frequency} ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}
