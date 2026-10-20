import { expect, test } from "vitest";
import { clockTime, timeBreak } from "../src/features/chat/format.ts";

const at = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
) => new Date(year, month - 1, day, hour, minute).getTime();
const now = at(2026, 1, 10, 12, 0);

test("message clock uses a two-digit 24-hour time", () => {
  expect(clockTime(at(2026, 1, 1, 13, 5))).toBe("13:05");
});

test("the first message always starts a time group", () => {
  expect(timeBreak(undefined, at(2026, 1, 10, 11, 58), now)).toBe("今天 11:58");
  expect(timeBreak(undefined, 0, 0)).toBe(`今天 ${clockTime(0)}`);
});

test("messages less than five minutes apart share a group", () => {
  expect(timeBreak(at(2026, 1, 10, 11, 50), at(2026, 1, 10, 11, 54), now)).toBe(
    null,
  );
});

test("a five-minute gap starts a new time group", () => {
  expect(timeBreak(at(2026, 1, 10, 11, 50), at(2026, 1, 10, 11, 55), now)).toBe(
    "今天 11:55",
  );
});

test("a calendar-day change starts a time group even after a short gap", () => {
  expect(timeBreak(at(2026, 1, 9, 23, 59), at(2026, 1, 10, 0, 1), now)).toBe(
    "今天 00:01",
  );
});

test("recent days use relative labels", () => {
  expect(timeBreak(undefined, at(2026, 1, 9, 23, 59), now)).toBe("昨天 23:59");
});

test("older dates include the date and weekday", () => {
  expect(timeBreak(undefined, at(2026, 1, 2, 9, 0), now)).toBe(
    "1月2日 周五 09:00",
  );
});

test("dates from another year include the year", () => {
  expect(timeBreak(undefined, at(2025, 12, 31, 23, 0), now)).toBe(
    "2025年12月31日 周三 23:00",
  );
});

test("unknown timestamps produce no time group", () => {
  expect(timeBreak(undefined, undefined, now)).toBeNull();
  expect(timeBreak(undefined, Number.NaN, now)).toBeNull();
});
