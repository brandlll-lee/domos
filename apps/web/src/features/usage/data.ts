import type { client } from "../../client.ts";

export type UsageRecord = Awaited<
  ReturnType<typeof client.engines.usage>
>[number];
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

export function usageValue(rows: UsageRecord[], metric: Metric): number | null {
  if (metric === "tasks") return new Set(rows.map((row) => row.taskId)).size;
  const values = rows
    .map((row) =>
      metric === "cost"
        ? row.costScope === "session"
          ? null
          : row.costUsd
        : row[metric],
    )
    .filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

export function usageTotals(rows: UsageRecord[]) {
  return {
    tasks: new Set(rows.map((row) => row.taskId)).size,
    records: rows.length,
    unpriced: rows.filter((row) => row.costUsd === null).length,
    snapshots: rows.filter((row) => row.costScope === "session").length,
    cost: usageValue(rows, "cost"),
    input: usageValue(rows, "input"),
    output: usageValue(rows, "output"),
    cacheRead: rows
      .map((row) => row.cacheRead)
      .filter((value): value is number => value !== null)
      .reduce<number | null>((sum, value) => (sum ?? 0) + value, null),
    cacheWrite: rows
      .map((row) => row.cacheWrite)
      .filter((value): value is number => value !== null)
      .reduce<number | null>((sum, value) => (sum ?? 0) + value, null),
  };
}

function groupKey(row: UsageRecord, dimension: Dimension) {
  return dimension === "bot" ? String(row.botId) : (row[dimension] ?? "未提供");
}

export type UsageGroup = {
  key: string;
  label: string;
  value: number | null;
  color: string;
  rows: UsageRecord[];
};

export function usageGroups(
  rows: UsageRecord[],
  dimension: Dimension,
  metric: Metric,
  names: Map<number, string>,
  limit: number,
): UsageGroup[] {
  const grouped = new Map<string, UsageRecord[]>();
  for (const row of rows) {
    const key = groupKey(row, dimension);
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  const keys = [...grouped.keys()].sort();
  const all = [...grouped]
    .map(([key, rows]) => ({
      key,
      rows,
      value: usageValue(rows, metric),
      label:
        dimension === "bot"
          ? (names.get(Number(key)) ?? `Bot ${key}`)
          : dimension === "harness"
            ? (harnesses.find((item) => item.value === key)?.label ?? key)
            : key,
      color: `var(--color-chart-${(keys.indexOf(key) % 5) + 1})`,
    }))
    .sort(
      (a, b) => (b.value ?? -1) - (a.value ?? -1) || a.key.localeCompare(b.key),
    );
  if (all.length <= limit) return all;
  const other = all.slice(limit).flatMap((group) => group.rows);
  return [
    ...all.slice(0, limit),
    {
      key: "other",
      label: "其他",
      value: usageValue(other, metric),
      color: "var(--color-chart-other)",
      rows: other,
    },
  ];
}

export function dailyUsage(rows: UsageRecord[], from: string, to: string) {
  const days: { day: string; rows: UsageRecord[] }[] = [];
  for (
    let date = Date.parse(from);
    date <= Date.parse(to);
    date += 86_400_000
  ) {
    const day = new Date(date).toISOString().slice(0, 10);
    days.push({ day, rows: [] });
  }
  const byDay = new Map(days.map((day) => [day.day, day.rows]));
  for (const row of rows)
    byDay.get(new Date(row.timestamp).toISOString().slice(0, 10))?.push(row);
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
