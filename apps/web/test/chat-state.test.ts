import type { ChatView } from "@domos/agent/view";
import { afterEach, expect, test, vi } from "vitest";
import {
  chatCacheUsage,
  chatState,
  clearChatState,
  retained,
  sweepChatCache,
} from "../src/features/chat/chat-state.ts";

afterEach(() => {
  clearChatState();
  vi.useRealTimers();
});
const view = (id: number, count = 1, text = "message"): ChatView => ({
  id,
  messages: Array.from({ length: count }, (_, i) => ({
    id: `${i}`,
    cursor: `${i + 1}:0`,
    turnId: `${i}`,
    role: "user",
    stopped: false,
    content: [{ type: "text", text, key: `${i}:text` }],
  })),
  model: null,
  instructions: "",
  draft: null,
  activeTurnId: null,
  busy: false,
  failed: false,
  tools: [],
});
test("35 conversations keep a bounded LRU and protect visible or unconfirmed sends", () => {
  vi.useFakeTimers();
  const active = chatState(1);
  const leave = active.subscribe(() => {});
  active.update({ view: view(1, 5, "x".repeat(200_000)) });
  const pending = chatState(2);
  pending.update({ pendingRequest: "pending", view: view(2) });
  for (let id = 3; id <= 35; id++) {
    vi.advanceTimersByTime(1);
    chatState(id).update({ view: view(id, 5, "x".repeat(200_000)) });
  }
  expect(chatCacheUsage().estimatedBytes).toBeLessThanOrEqual(32 * 1024 * 1024);
  expect(retained.get("1")).toBe(active);
  expect(retained.get("2")).toBe(pending);
  expect(retained.has("3")).toBe(false);
  expect(retained.has("35")).toBe(true);
  leave();
});
test("leaving trims older pages and stale running flags do not block expiry", () => {
  vi.useFakeTimers();
  const store = chatState(1);
  const leave = store.subscribe(() => {});
  store.update({ view: { ...view(1, 400), busy: true }, history: view(1) });
  leave();
  expect(store.snapshot().history).toBeUndefined();
  expect(store.snapshot().view?.messages).toHaveLength(200);
  expect(store.snapshot().view?.before).toBe("201:0");
  vi.advanceTimersByTime(10 * 60_000);
  sweepChatCache();
  expect(retained.size).toBe(0);
  expect(store.controller.signal.aborted).toBe(true);
  store.update({ view: view(1) });
  expect(retained.size).toBe(0);
});
test("computer changes abort prefetch and reject late writes", () => {
  const old = chatState(1);
  clearChatState();
  const next = chatState(1);
  old.update({ view: view(1) });
  expect(old.controller.signal.aborted).toBe(true);
  expect(next.snapshot().view).toBeNull();
});
