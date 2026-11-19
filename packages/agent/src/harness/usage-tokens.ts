import type { EngineTokens, EngineUsage } from "./types.ts";

export const tokenFields = [
  "input",
  "cacheRead",
  "cacheWrite",
  "output",
] as const;

export function uncachedTokens(tokens: EngineTokens): EngineTokens {
  const { input, cacheRead, cacheWrite } = tokens;
  return {
    ...tokens,
    input:
      input === null || cacheRead === null || cacheWrite === null
        ? null
        : input - cacheRead - cacheWrite,
  };
}

export function usageTokens<T extends EngineUsage>(row: T, harness: string): T {
  const nativeTokens = Object.fromEntries(
    tokenFields.map((key) => [key, row[key]]),
  ) as EngineTokens;
  const tokens =
    row.tokenBasis === "uncached" ||
    ["pi", "claude", "opencode"].includes(harness)
      ? nativeTokens
      : uncachedTokens(nativeTokens);
  for (const key of tokenFields) {
    const value = tokens[key];
    if (value !== null && (!Number.isSafeInteger(value) || value < 0))
      throw new RangeError(`${harness} 用量计数无效：${key}。`);
  }
  return {
    ...row,
    ...tokens,
    nativeTokens: row.nativeTokens ?? nativeTokens,
    tokenBasis: "uncached",
  };
}

export function tokenDelta(
  current: EngineTokens,
  previous?: EngineTokens,
): EngineTokens {
  const reset = tokenFields.some(
    (key) =>
      current[key] !== null &&
      previous?.[key] != null &&
      Number(current[key]) < Number(previous[key]),
  );
  return Object.fromEntries(
    tokenFields.map((key) => {
      const value = current[key];
      const before = previous?.[key];
      return [
        key,
        reset || value === null || before == null ? null : value - before,
      ];
    }),
  ) as EngineTokens;
}
