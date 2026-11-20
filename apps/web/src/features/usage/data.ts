import type { client } from "../../client.ts";

export type UsageRecord = Awaited<
  ReturnType<typeof client.engines.usage>
>["items"][number];
export type UsageSummary = Awaited<
  ReturnType<typeof client.engines.usageSummary>
>;
export type Metric = Parameters<
  typeof client.engines.usageSummary
>[0]["metric"];
export type Dimension = Parameters<
  typeof client.engines.usageSummary
>[0]["dimension"];
export type UsagePeriod =
  | "month"
  | "lastMonth"
  | "days7"
  | "days30"
  | "days90"
  | "days365";

export const metrics = [
  { value: "cost", label: "费用" },
  { value: "tokens", label: "Token" },
] as const;
export const dimensions = [
  { value: "model", label: "模型" },
  { value: "provider", label: "Provider" },
  { value: "harness", label: "Harness" },
  { value: "bot", label: "Bot" },
  { value: "day", label: "日期" },
  { value: "purpose", label: "任务用途" },
  { value: "skill", label: "关联技能" },
] as const;
export const purposes: Record<string, string> = {
  private: "对话",
  team: "团队",
  delegation: "委派",
  routine: "例程",
  compact: "上下文压缩",
  memory: "记忆审阅",
};
export const harnesses = [
  { value: "acp", label: "自定义 ACP" },
  { value: "pi", label: "Pi" },
  { value: "codex", label: "Codex" },
  { value: "claude", label: "Claude Code" },
  { value: "opencode", label: "OpenCode" },
  { value: "grok", label: "Grok" },
  { value: "antigravity", label: "Antigravity" },
  { value: "devin", label: "Devin" },
  { value: "cursor", label: "Cursor" },
];

export const compactNumber = (value: number) =>
  new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
export const money = (value: number | null, precise = false): string =>
  value === null
    ? "暂无法估价"
    : !precise && value > 0 && value < 0.01
      ? "<US$0.01"
      : new Intl.NumberFormat("en", {
          style: "currency",
          currency: "USD",
          currencyDisplay: "code",
          minimumFractionDigits: 2,
          maximumFractionDigits: precise ? 6 : 2,
        })
          .format(value)
          .replace("USD", "US$")
          .replace(/\s/g, "");
export const formatValue = (value: number | null, metric: Metric) =>
  value === null
    ? "—"
    : metric === "cost"
      ? money(value)
      : compactNumber(value);
export const formatAxis = (value: number, metric: Metric) =>
  metric === "cost"
    ? `$${new Intl.NumberFormat("en", {
        notation: value >= 1000 ? "compact" : "standard",
        maximumFractionDigits: value > 0 && value < 0.01 ? 6 : 2,
      }).format(value)}`
    : compactNumber(value);

export type UsageGroup = UsageSummary["groups"][number] & { label: string };

export function dailyUsage(
  summary: UsageSummary,
  metric: Metric,
  from: string,
  to: string,
) {
  const values = new Map(summary.days.map((row) => [row.day, row[metric]]));
  const days: { day: string; value: number | null }[] = [];
  for (
    let date = Date.parse(from);
    date <= Date.parse(to);
    date += 86_400_000
  ) {
    const day = new Date(date).toISOString().slice(0, 10);
    days.push({ day, value: values.get(day) ?? null });
  }
  return days;
}

export const dayLabel = (day: string) => {
  const [, month, date] = day.split("-");
  return `${Number(month)}月${Number(date)}日`;
};
export const recordTime = (timestamp: number) => {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
};

export function usagePeriodRange(
  period: UsagePeriod,
  now = new Date(),
): { from: string; to: string } {
  const day = (date: Date) => date.toISOString().slice(0, 10);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  if (period === "month")
    return { from: day(new Date(Date.UTC(year, month, 1))), to: day(now) };
  if (period === "lastMonth")
    return {
      from: day(new Date(Date.UTC(year, month - 1, 1))),
      to: day(new Date(Date.UTC(year, month, 0))),
    };
  return {
    from: day(
      new Date(now.getTime() - (Number(period.slice(4)) - 1) * 86_400_000),
    ),
    to: day(now),
  };
}
