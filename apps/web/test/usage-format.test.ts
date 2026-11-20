import { expect, test } from "vitest";
import { quotaGroups, quotaReset } from "../src/features/usage/data.ts";

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
