import type { ChatMessage } from "@domos/agent/messages";
import type { TranscriptItem } from "@domos/agent/transcript";
import type { ChatView } from "@domos/agent/view";
import { expect, test } from "vitest";
import {
  mergeChatMessages,
  transcriptState,
} from "../src/features/chat/transcript-state.ts";

test("confirmed sends and completed replies retain their visible position and identity", () => {
  const project = transcriptState();
  const message = (
    id: string,
    role: ChatMessage["role"],
    text: string,
  ): ChatMessage => ({
    id,
    role,
    content: [{ type: "text", text, key: id }],
    stopped: false,
  });
  const first = message("first", "user", "HKD");
  const progress = message("progress", "assistant", "Checking");
  const second = { ...message("second", "user", "USD"), requestId: "send" };
  const final = message("final", "assistant", "Done");
  const outgoing: TranscriptItem = {
    kind: "message",
    id: "send",
    message: second,
  };
  const view = (messages: ChatMessage[]) =>
    ({ messages, busy: true, failed: false }) as ChatView;
  project(view([first, progress]));
  const pending = project(view([first, progress]), [outgoing]).items;
  const confirmed = project(view([first, progress, second]), [outgoing]).items;
  expect(confirmed.map((item) => item.id)).toEqual([
    "first",
    "progress",
    "send",
  ]);
  expect(confirmed[1]).toBe(pending[1]);
  expect(
    project(view([first, progress, second, final])).items.map(
      (item) => item.id,
    ),
  ).toEqual(["first", "progress", "send", "final"]);
  const complete = project(view([first, progress, second, final])).items;
  expect(project(view([first, progress, second, final])).items).toBe(complete);
  const shared = project(
    view([
      first,
      progress,
      second,
      final,
      {
        ...second,
        id: "other-member-copy",
        turnId: "other-turn",
        sessionId: 3,
      },
    ]),
  ).items;
  expect(shared.map((item) => item.id)).toEqual([
    "first",
    "progress",
    "send",
    "final",
  ]);

  const concurrent = transcriptState();
  const other = message("other", "user", "Other window");
  concurrent(view([first]), [outgoing]);
  concurrent(view([first, other, progress]), [outgoing]);
  const accepted = view([first, other, progress, second]);
  expect(concurrent(accepted, [outgoing]).items.map((item) => item.id)).toEqual(
    ["first", "other", "progress", "send"],
  );
});

test("late historical replies follow saved cursors through updates and reconnects", () => {
  const message = (
    id: string,
    role: ChatMessage["role"],
    cursor?: string,
  ): ChatMessage => ({
    id,
    role,
    cursor,
    content: [{ type: "text", text: id, key: id }],
    stopped: false,
  });
  const oldUser = message("old-user", "user", "9:0");
  const oldReply = message("old-reply", "assistant", "10:0");
  const today = message("today", "user", "20:0");
  const reply = message("reply", "assistant", "21:0");
  const draft = message("draft", "assistant");
  const view = (messages: ChatMessage[]) =>
    ({ messages, busy: true, failed: false }) as ChatView;
  const project = transcriptState();
  const initial = [oldUser, today, reply, draft];
  const before = project(view(initial)).items;
  expect(
    project(view([oldUser, oldReply, today, reply, draft])).items.map(
      (item) => item.id,
    ),
  ).toEqual(["old-user", "old-reply", "today", "reply", "draft"]);
  const merged = mergeChatMessages(initial, [oldReply]);
  expect(merged.map((message) => message.id)).toEqual([
    "old-user",
    "old-reply",
    "today",
    "reply",
    "draft",
  ]);
  const after = project(view(merged)).items;
  expect(after.map((item) => item.id)).toEqual(
    merged.map((message) => message.id),
  );
  expect(after[2]).toBe(before[1]);
  expect(after[3]).toBe(before[2]);
  expect(project(view([oldUser, oldReply, today, reply, draft])).items).toBe(
    after,
  );
  const settled = mergeChatMessages(
    merged,
    [{ ...draft, cursor: "22:0" }],
    ["reply"],
  );
  expect(settled.map((message) => message.id)).toEqual([
    "old-user",
    "old-reply",
    "today",
    "draft",
  ]);
  expect(settled[0]).toBe(oldUser);
  expect(
    mergeChatMessages([reply, today], [oldReply, oldUser]).map(
      (message) => message.id,
    ),
  ).toEqual(["old-user", "old-reply", "today", "reply"]);
});
