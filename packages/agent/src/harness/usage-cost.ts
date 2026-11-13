import type { EngineUsage } from "./types.ts";

const rates: Record<string, [number, number, number, number]> = {
  "gpt-6-astra": [10, 1, 12.5, 50],
  "gpt-6.1-sol": [2, 0.1, 2.5, 10],
  "gpt-6.1-terra": [1, 0.05, 1.25, 5],
  "gpt-6-luna": [0.1, 0.01, 0.125, 0.5],
};

export function priceUsage<T extends EngineUsage>(row: T, harness: string): T {
  if (row.costUsd !== null)
    return {
      ...row,
      costBasis: row.costBasis ?? "reported",
      costSource: row.costSource ?? row.source,
    };
  const price =
    harness === "codex" && row.provider === "openai" && row.model
      ? rates[row.model]
      : undefined;
  const { input, cacheRead: cached, cacheWrite: written, output } = row;
  const counts = [input, cached, written, output];
  if (
    !price ||
    counts.some(
      (value) => value === null || !Number.isFinite(value) || value < 0,
    )
  )
    return row;
  if (input === null || cached === null || written === null || output === null)
    return row;
  if (input < cached + written || input > 272_000) return row;
  return {
    ...row,
    costUsd:
      ((input - cached - written) * price[0] +
        cached * price[1] +
        written * price[2] +
        output * price[3]) /
      1_000_000,
    costBasis: "estimated",
    costSource: "https://developers.openai.com/api/docs/pricing",
    costVersion: "2026-11-13 · standard API · short context · 30m cache",
  };
}

export class CumulativeCost {
  private previous: number | null;
  private readonly values = new Map<string, number | null>();
  constructor(resumed: boolean) {
    this.previous = resumed ? null : 0;
  }
  read(id: string, value: number | undefined): number | null {
    if (this.values.has(id)) return this.values.get(id) ?? null;
    let delta: number | null = null;
    if (value !== undefined && Number.isFinite(value) && value >= 0) {
      if (this.previous !== null)
        delta = value >= this.previous ? value - this.previous : value;
      this.previous = value;
    } else this.previous = null;
    this.values.set(id, delta);
    return delta;
  }
}
