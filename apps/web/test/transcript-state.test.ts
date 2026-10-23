import type { ChatMessage } from "@domos/agent/messages";
import type { TranscriptItem } from "@domos/agent/transcript";
import type { ChatView } from "@domos/agent/view";
import { expect, test } from "vitest";
import { transcriptState } from "../src/features/chat/transcript-state.ts";

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
  const confirmed = project(view([first, second, progress]), [outgoing]).items;
  expect(confirmed.map((item) => item.id)).toEqual([
    "first",
    "progress",
    "send",
  ]);
  expect(confirmed[1]).toBe(pending[1]);
  expect(
    project(view([first, second, progress, final])).items.map(
      (item) => item.id,
    ),
  ).toEqual(["first", "progress", "send", "final"]);
  const complete = project(view([first, second, progress, final])).items;
  expect(project(view([first, second, progress, final])).items).toBe(complete);
});
