export type UsagePeriod = "month" | "lastMonth" | "days30";

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
