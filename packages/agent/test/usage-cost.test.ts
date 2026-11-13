import { expect, test } from "vitest";
import type { EngineUsage } from "../src/harness/types.ts";
import { CumulativeCost, priceUsage } from "../src/harness/usage-cost.ts";

const usage: EngineUsage = {
  id: "turn",
  source: "native",
  provider: "openai",
  model: "gpt-6.1-terra",
  input: 1000,
  cacheRead: 200,
  cacheWrite: 0,
  output: 100,
  costUsd: null,
};
test("cost estimates require exact models and complete native token counters", () => {
  expect(priceUsage(usage, "codex")).toMatchObject({
    costUsd: 0.00131,
    costBasis: "estimated",
    costSource: "https://developers.openai.com/api/docs/pricing",
  });
  for (const row of [
    { ...usage, model: "alias" },
    { ...usage, provider: "custom" },
    { ...usage, cacheWrite: null },
    { ...usage, input: 300_000 },
    { ...usage, cacheRead: 2000 },
  ])
    expect(priceUsage(row, "codex").costUsd).toBeNull();
  for (const harness of ["pi", "opencode", "claude", "codex"]) {
    expect(priceUsage({ ...usage, costUsd: 0 }, harness)).toMatchObject({
      costUsd: 0,
      costBasis: "reported",
    });
    if (harness !== "codex")
      expect(priceUsage(usage, harness).costUsd).toBeNull();
  }
});
test("cumulative costs track deltas, duplicates, resets and uncertain resume baselines", () => {
  const fresh = new CumulativeCost(false);
  expect(fresh.read("a", 2)).toBe(2);
  expect(fresh.read("a", 2)).toBe(2);
  expect(fresh.read("b", 5)).toBe(3);
  expect(fresh.read("c", 1)).toBe(1);
  expect(fresh.read("d", undefined)).toBeNull();
  expect(fresh.read("e", 8)).toBeNull();
  expect(fresh.read("f", 9)).toBe(1);
  const resumed = new CumulativeCost(true);
  expect(resumed.read("a", 100)).toBeNull();
  expect(resumed.read("b", 101)).toBe(1);
});
