import type { client } from "../../client.ts";

export type UsageRecord = Awaited<
  ReturnType<typeof client.engines.usage>
>["items"][number];
export type UsageSummary = Awaited<
  ReturnType<typeof client.engines.usageSummary>
>;
export type Metric = "cost" | "tasks" | "input" | "output";
export type Dimension = "model" | "provider" | "harness" | "bot";
export type UsagePeriod = "month" | "lastMonth" | "days30";

export const metrics = [
  { value: "cost", label: "任务成本", unit: "USD" },
  { value: "tasks", label: "任务数", unit: "次" },
  { value: "input", label: "输入用量", unit: "tok" },
  { value: "output", label: "输出用量", unit: "tok" },
] as const;
export const dimensions = [
  { value: "model", label: "模型" },
  { value: "provider", label: "Provider" },
  { value: "harness", label: "Harness" },
  { value: "bot", label: "Bot" },
] as const;
export const harnesses = [
  { value: "pi", label: "Pi" },
  { value: "codex", label: "Codex" },
  { value: "claude", label: "Claude Code" },
  { value: "opencode", label: "OpenCode" },
];

export const metricLabel = (metric: Metric) =>
  metrics.find((item) => item.value === metric)?.label ?? metric;
export const metricUnit = (metric: Metric) =>
  metrics.find((item) => item.value === metric)?.unit ?? "";

export const compactNumber = (value: number) =>
  new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
export const money = (value: number | null) =>
  value === null
    ? "未提供"
    : new Intl.NumberFormat("en", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      }).format(value);
export const formatValue = (value: number | null, metric: Metric) =>
  value === null
    ? "—"
    : metric === "cost"
      ? money(value)
      : compactNumber(value);
export const formatAxis = (value: number, metric: Metric, decimals: number) =>
  metric === "cost"
    ? `$${new Intl.NumberFormat("en", {
        notation: value >= 1000 ? "compact" : "standard",
        maximumFractionDigits: decimals,
      }).format(value)}`
    : compactNumber(value);

export type UsageGroup = {
  key: string;
  label: string;
  value: number | null;
  color: string;
};

export function dailyUsage(
  summary: UsageSummary,
  groups: UsageGroup[],
  from: string,
  to: string,
) {
  const values = new Map(
    summary.daily.map((row) => [`${row.day}:${row.key}`, row.value]),
  );
  const days = [];
  for (
    let date = Date.parse(from);
    date <= Date.parse(to);
    date += 86_400_000
  ) {
    const day = new Date(date).toISOString().slice(0, 10);
    const series = groups.map(
      (group) => values.get(`${day}:${group.key}`) ?? null,
    );
    days.push({
      day,
      values: series,
      total: series.reduce<number>((sum, value) => sum + (value ?? 0), 0),
    });
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
    from: day(new Date(now.getTime() - 29 * 24 * 60 * 60_000)),
    to: day(now),
  };
}
