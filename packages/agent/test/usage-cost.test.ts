import { expect, test } from "vitest";
import type { EngineUsage } from "../src/harness/types.ts";
import { priceUsage } from "../src/harness/usage-cost.ts";

const usage: EngineUsage = {
  id: "turn",
  source: "native",
  provider: "openai",
  model: "gpt-6.1-terra",
  input: 800,
  cacheRead: 200,
  cacheWrite: 0,
  output: 100,
  costUsd: null,
};
test("cost estimates require exact models and complete native token counters", () => {
  expect(priceUsage(usage, "codex")).toMatchObject({
    costUsd: 0.00131,
    costBasis: "estimated",
    costSource: "https://developers.openai.com/api/docs/pricing.md",
  });
  for (const row of [
    { ...usage, model: "alias" },
    { ...usage, provider: "custom" },
    { ...usage, cacheWrite: null },
    { ...usage, input: 300_000 },
  ])
    expect(priceUsage(row, "codex").costUsd).toBeNull();
  for (const harness of ["pi", "opencode", "claude", "codex"]) {
    expect(priceUsage({ ...usage, costUsd: 0 }, harness)).toMatchObject({
      costUsd: 0,
      costBasis: "reported",
    });
    expect(priceUsage(usage, harness).costUsd).toBe(0.00131);
  }
});

test("pricing keeps date, context, cache lifetime and native zero distinct", () => {
  expect(
    priceUsage(usage, "codex", Date.parse("2026-11-01")).costUsd,
  ).toBeNull();
  const long = { ...usage, input: 300_000, requestInput: 300_200 };
  expect(priceUsage(long, "codex").costUsd).toBeCloseTo(0.60077);
  expect(
    priceUsage({ ...long, requestInput: undefined }, "codex").pricingReason,
  ).toContain("档位");
  const write = {
    ...usage,
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    input: 100,
    cacheRead: 0,
    cacheWrite: 100,
    output: 10,
  };
  expect(priceUsage(write, "claude").pricingReason).toContain("期限");
  expect(
    priceUsage({ ...write, cacheWriteMinutes: 5 }, "claude").costUsd,
  ).toBeCloseTo(0.000825);
  expect(
    priceUsage({ ...write, cacheWriteMinutes: 60 }, "claude").costUsd,
  ).toBeCloseTo(0.00105);
  expect(() => priceUsage({ ...usage, costUsd: -1 }, "codex")).toThrow(
    "原生金额无效",
  );
});
