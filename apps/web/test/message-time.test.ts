import { expect, test } from "vitest";
import { clockTime, messageDay } from "../src/features/chat/format.ts";

test("message dates preserve epoch zero and omit unknown timestamps", () => {
  const message = {
    id: "1",
    role: "user" as const,
    content: [],
    stopped: false,
  };
  expect(messageDay({ kind: "message", id: "1", message })).toBeUndefined();
  expect(
    messageDay({
      kind: "message",
      id: "1",
      message: { ...message, timestamp: 0 },
    }),
  ).toBeTypeOf("number");
});

test("message clock uses a two-digit 24-hour time", () => {
  expect(clockTime(new Date(2026, 0, 1, 13, 5).getTime())).toBe("13:05");
});
