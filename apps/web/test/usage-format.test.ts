import { expect, test } from "vitest";
import {
  dailyUsage,
  quotaGroups,
  quotaReset,
  type UsageSummary,
} from "../src/features/usage/data.ts";

test("daily usage distinguishes idle dates, missing tasks and partial native records", () => {
  const totals: UsageSummary["totals"] = {
    records: 1,
    tasks: 1,
    unpriced: 0,
    snapshots: 0,
    estimated: 0,
    incomplete: 0,
    historical: 0,
    tokens: 20,
    cost: 1,
    input: 10,
    output: 10,
    cacheRead: 0,
    cacheWrite: 0,
  };
  const summary = {
    startedAt: Date.parse("2026-11-02"),
    engines: [{ ...totals, key: "pi" }],
    days: [
      { ...totals, day: "2026-11-02", cost: null, unpriced: 1 },
      { ...totals, day: "2026-11-05", unpriced: 1, incomplete: 1 },
    ],
    engineDays: [
      { ...totals, key: "pi", day: "2026-11-02", cost: null, unpriced: 1 },
      { ...totals, key: "pi", day: "2026-11-05", unpriced: 1, incomplete: 1 },
    ],
    missingDays: [
      { key: "pi", day: "2026-11-04" },
      { key: "codex", day: "2026-11-05" },
    ],
  };
  const cost = dailyUsage(summary, "cost", "2026-11-01", "2026-11-05");
  expect(cost.map((day) => day.value)).toEqual([null, null, 0, null, 1]);
  expect(cost.map((day) => day.partial)).toEqual([
    true,
    true,
    false,
    true,
    true,
  ]);
  expect(cost[4]?.engines).toEqual([
    { key: "pi", value: 1, partial: true },
    { key: "codex", value: null, partial: true },
  ]);
  expect(
    dailyUsage(summary, "tokens", "2026-11-02", "2026-11-02")[0],
  ).toMatchObject({
    value: 20,
    partial: false,
  });
  expect(
    dailyUsage(
      {
        ...summary,
        startedAt: null,
        days: [],
        engineDays: [],
        missingDays: [],
      },
      "cost",
      "2026-11-01",
      "2026-11-02",
    ).map((day) => day.value),
  ).toEqual([null, null]);
});

test("quota reset times keep missing and expired readings distinct", () => {
  const now = 1_000_000;
  expect(quotaReset(null, now)).toBe("重置时间未提供");
  expect(quotaReset(now, now)).toBe("等待更新");
  expect(quotaReset(now + 60_000, now)).toBe("1 分钟后重置");
  expect(quotaReset(now + 3_660_000, now)).toBe("1 小时 1 分钟后重置");
  expect(quotaReset(now + 89_940_000, now)).toBe("1 天 0 小时后重置");
});

test("quota groups retain native evidence and use reported periods", () => {
  const windows = [
    {
      id: "week",
      name: "Gemini Models · Weekly Limit Remaining",
      durationMinutes: 10080,
      usedPercent: 10,
      resetsAt: null,
    },
    {
      id: "session",
      name: "Gemini Models · Five Hour Limit Remaining",
      durationMinutes: 300,
      usedPercent: 0,
      resetsAt: 1000,
    },
    {
      id: "unknown",
      name: "Other · Special",
      durationMinutes: null,
      usedPercent: 100,
      resetsAt: null,
    },
  ];
  const groups = quotaGroups(windows);
  expect(groups.map((group) => group.name)).toEqual(["Gemini Models", ""]);
  expect(groups[0]?.rows.map((row) => row.label)).toEqual(["每周", "5 小时"]);
  expect(groups[0]?.rows[0]?.window).toBe(windows[0]);
  expect(groups[1]?.rows[0]?.label).toBe("Other · Special");
});
