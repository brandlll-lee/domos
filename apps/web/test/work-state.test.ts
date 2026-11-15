import type { EngineRun } from "@domos/agent/harness/types";
import type { ChatView } from "@domos/agent/view";
import { expect, test } from "vitest";
import {
  chatActivity,
  executionActivity,
} from "../src/features/chat/activity-state.ts";
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
      title: "等待执行",
      author: { name: "Reviewer" },
    },
  ]);
  view.activity = [];
  expect(workTurns(view)).toEqual([]);
});

function running() {
  const run: EngineRun = {
    turnId: "turn",
    sessionId: 1,
    provider: "pi",
    model: null,
    startedAt: 1,
    status: "running",
  };
  const activity: NonNullable<ChatView["activity"]>[number] = {
    botId: 1,
    sessionId: 1,
    executionId: "turn",
    processing: true,
  };
  const view: ChatView = {
    id: 1,
    model: null,
    instructions: "",
    messages: [],
    draft: null,
    activeTurnId: "turn",
    busy: true,
    processing: true,
    failed: false,
    tools: [],
    runs: [run],
    activity: [activity],
  };
  return { view, run, activity };
}

test.each([
  ["codex", "commandExecution", "正在运行命令"],
  ["claude", "Read", "正在读取文件"],
  ["opencode", "webfetch", "正在读取网页"],
  ["pi", "read", "正在读取文件"],
  ["acp", "mcp__browser__web_search", "正在搜索网页"],
  ["pi", "custom_tool", "正在使用工具"],
])(
  "%s activity uses the shared native tool record %s",
  (provider, name, label) => {
    const { view, run } = running();
    run.provider = provider;
    view.messages = [
      {
        id: "call",
        turnId: "turn",
        role: "assistant",
        stopped: false,
        content: [
          {
            type: "toolCall",
            id: "call",
            key: "call",
            name,
            arguments: { path: "private-path", command: "secret-command" },
          },
        ],
      },
    ];
    expect(chatActivity(view)[0]).toMatchObject({ label, working: true });
    expect(workTurns(view)[0]?.title).toBe(label);
    view.messages.push({
      id: "result",
      turnId: "turn",
      role: "toolResult",
      stopped: false,
      toolCallId: "call",
      toolStatus: "running",
      content: [],
    });
    expect(chatActivity(view)[0]?.label).toBe(label);
    view.messages = view.messages.map((message) =>
      message.toolCallId ? { ...message, toolStatus: "done" } : message,
    );
    expect(chatActivity(view)[0]?.label).toBe("正在工作");
    view.draft = {
      id: "reply",
      turnId: "turn",
      role: "assistant",
      stopped: false,
      pending: true,
      content: [{ type: "text", key: "reply", text: "User-visible reply" }],
    };
    expect(chatActivity(view)[0]?.label).toBe("正在回复");
    view.draft.endedAt = 4;
    expect(chatActivity(view)[0]?.label).toBe("正在工作");
    view.draft = null;
    run.status = "ended";
    view.busy = false;
    expect(chatActivity(view)).toEqual([]);
  },
);

test("waiting and stopping take priority over native tool activity", () => {
  const { view, run, activity } = running();
  for (const [kind, label] of [
    ["question", "等你回答"],
    ["permission", "等你确认"],
  ] as const) {
    view.approvals = [{ id: "question", title: "Approve", detail: "", kind }];
    expect(chatActivity(view)[0]).toMatchObject({ label, working: false });
    expect(
      workTurns({
        ...view,
        messages: [
          {
            id: "input",
            turnId: "turn",
            role: "user",
            stopped: false,
            content: [],
          },
        ],
      })[0]?.title,
    ).toBe(label);
  }
  view.approvals = [];
  for (const [waiting, label] of [
    ["等待你完成接管。", "等你完成接管"],
    ["等待你的回答。", "等你回答"],
    ["等待你的确认。", "等你确认"],
    ["排队中，等待前一项任务完成。", "等待执行"],
  ]) {
    activity.waiting = waiting;
    expect(chatActivity(view)[0]).toMatchObject({ label, working: false });
  }
  run.status = "stopping";
  expect(chatActivity(view)[0]).toMatchObject({
    label: "正在停止",
    working: false,
  });
  run.status = "running";
  delete activity.waiting;
  view.runtime = { compaction: "running" };
  expect(chatActivity(view)[0]?.label).toBe("正在整理上下文");
  view.runtime = { retry: "Network unavailable" };
  expect(chatActivity(view)[0]).toMatchObject({
    label: "正在等待引擎响应",
    working: false,
  });
  run.status = "failed";
  activity.processing = false;
  expect(chatActivity(view)).toEqual([]);
  view.busy = false;
  expect(chatActivity(view)).toEqual([]);
  expect(chatActivity(null)).toEqual([]);
});

test("team activity retains execution identity and isolates member waits", () => {
  const { view, run, activity } = running();
  const author = { botId: 2, name: "Reviewer", avatar: "reviewer" };
  view.runs?.push({
    turnId: "review",
    sessionId: 3,
    provider: "codex",
    model: null,
    startedAt: 2,
    status: "running",
  });
  view.activity?.push({
    botId: 2,
    sessionId: 3,
    executionId: "review",
    processing: false,
    waiting: "等待你的回答。",
    author,
  });
  activity.author = { botId: 1, name: "Writer", avatar: "writer" };
  view.approvals = [
    { id: "review-question", kind: "question", title: "Review?", detail: "" },
  ];
  view.messages = [
    {
      id: "text",
      sessionId: 1,
      turnId: "turn",
      role: "assistant",
      stopped: false,
      pending: true,
      content: [{ type: "text", key: "text", text: "Draft" }],
    },
  ];
  expect(chatActivity(view)).toMatchObject([
    { id: "turn", botId: 1, label: "正在回复", working: true },
    { id: "review", botId: 2, author, label: "等你回答", working: false },
  ]);
  expect(
    executionActivity(view, {
      turnId: "review",
      sessionId: 3,
      status: "running",
    }).label,
  ).toBe("等你回答");
  run.inputTurns = ["additional"];
  view.messages = view.messages.map((message) => ({
    ...message,
    turnId: "additional",
  }));
  expect(chatActivity(view)[0]?.label).toBe("正在回复");
});
