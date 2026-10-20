import type { client } from "../../client.ts";

export type UsageRecord = Awaited<
  ReturnType<typeof client.engines.usage>
>[number];
export type Metric = "cost" | "input" | "output" | "tasks";
export type Dimension = "model" | "provider" | "harness" | "bot";
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
export const formatValue = (value: number | null, metric: Metric) =>
  value === null
    ? "—"
    : metric === "cost"
      ? money(value)
      : compactNumber(value);
export function groupKey(row: UsageRecord, dimension: Dimension) {
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
            ? (harnesses.find((h) => h.value === key)?.label ?? key)
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
