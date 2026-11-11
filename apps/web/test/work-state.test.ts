import type { ChatView } from "@domos/agent/view";
import { expect, test } from "vitest";
import { workTurns } from "../src/features/chat/work-state.ts";

test("Work retains each queued recipient after the shared user message is deduplicated", () => {
  const view: ChatView = {
    id: 1,
    model: null,
    instructions: "",
    messages: [],
    draft: null,
    activeTurnId: null,
    busy: true,
    processing: false,
    failed: false,
    tools: [],
    activity: [
      {
        botId: 2,
        sessionId: 3,
        executionId: "review",
        processing: false,
        waiting: "正在处理另一项任务，完成后继续。",
        author: { botId: 2, name: "Reviewer", avatar: "reviewer" },
      },
    ],
  };
  expect(workTurns(view)).toMatchObject([
    {
      id: "review",
      sessionId: 3,
      active: true,
      status: "queued",
      title: view.activity?.[0]?.waiting,
      author: { name: "Reviewer" },
    },
  ]);
  view.activity = [];
  expect(workTurns(view)).toEqual([]);
});
