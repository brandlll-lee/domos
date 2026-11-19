import type { EngineUsage } from "./types.ts";
import { usagePrices } from "./usage-prices.ts";

export function priceUsage<T extends EngineUsage>(
  row: T,
  harness: string,
  timestamp = Date.now(),
): T {
  if (row.costUsd !== null) {
    if (!Number.isFinite(row.costUsd) || row.costUsd < 0)
      throw new RangeError("原生金额无效。");
    return {
      ...row,
      costBasis: row.costBasis ?? "reported",
      costSource: row.costSource ?? row.source,
    };
  }
  const unknown = (pricingReason: string): T => ({
    ...row,
    pricingReason: row.pricingReason ?? pricingReason,
  });
  const provider =
    row.provider ??
    ({ claude: "anthropic", grok: "xai" } as Record<string, string>)[harness];
  const model = row.model?.replace(/\[1m\]$/i, "");
  const price = usagePrices.findLast(
    (item) =>
      item.provider === provider &&
      item.model === model &&
      timestamp >= Date.parse(item.from),
  );
  if (!price) return unknown("此日期的模型价格未核验。");
  const { input, cacheRead, cacheWrite, output } = row;
  if (
    [input, cacheRead, cacheWrite, output].some(
      (value) => value === null || !Number.isSafeInteger(value) || value < 0,
    )
  )
    return unknown("原生 token 字段不完整或无效。");
  if (
    input === null ||
    cacheRead === null ||
    cacheWrite === null ||
    output === null
  )
    return row;
  const prompt = input + cacheRead + cacheWrite;
  const long = price.threshold !== undefined && prompt >= price.threshold;
  if (
    long &&
    prompt !== row.requestInput &&
    (row.smallestRequestInput === undefined ||
      row.smallestRequestInput < (price.threshold ?? 0))
  )
    return unknown("多次请求的上下文档位无法确认。");
  const rates = long ? price.long : price.rates;
  if (!rates) return unknown("此上下文档位的价格未核验。");
  let written = 0;
  const writeRate =
    row.cacheWriteMinutes === undefined
      ? undefined
      : price.writes?.[row.cacheWriteMinutes];
  if (cacheWrite) {
    if (row.cacheWrite1h !== undefined && provider === "anthropic") {
      if (row.cacheWrite1h > cacheWrite || row.cacheWrite1h < 0)
        return unknown("缓存期限计数无效。");
      written =
        (cacheWrite - row.cacheWrite1h) * rates[2] * 1.25 +
        row.cacheWrite1h * rates[2] * 2;
    } else if (writeRate !== undefined) {
      const multiplier = long && price.rates[2] ? rates[2] / price.rates[2] : 1;
      written = cacheWrite * multiplier * writeRate;
    } else return unknown("缓存写入期限未提供。");
  }
  return {
    ...row,
    costUsd:
      (input * rates[0] + cacheRead * rates[1] + written + output * rates[3]) /
      1_000_000,
    costBasis: "estimated",
    costSource: price.source,
    costVersion: JSON.stringify({
      from: price.from,
      verified: price.verified,
      context: long ? "long" : "short",
      rates,
      cacheWriteMinutes: row.cacheWriteMinutes,
      cacheWrite1h: row.cacheWrite1h,
      unit: "USD/1M tokens",
      tier: "standard API equivalent",
    }),
    pricingReason: undefined,
  };
}
