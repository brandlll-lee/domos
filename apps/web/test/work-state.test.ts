import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { EngineRun } from "@domos/agent/harness/types";
import type { ChatMessage } from "@domos/agent/messages";
import type { ChatView } from "@domos/agent/view";
import { expect, test } from "vitest";
import {
  chatActivity,
  executionActivity,
} from "../src/features/chat/activity-state.ts";
import {
  workGroups,
  workTime,
  workTurns,
} from "../src/features/chat/work-state.ts";

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

test("Work identifies an execution by the first input line and retains additional input in its detail", () => {
  const { view, run } = running();
  run.inputTurns = ["follow-up"];
  view.messages = [
    {
      id: "request",
      turnId: "turn",
      role: "user",
      stopped: false,
      content: [
        {
          type: "text",
          key: "request",
          text: "\n重新设计项目报价单\n保留价格",
        },
      ],
    },
    {
      id: "additional",
      turnId: "follow-up",
      role: "user",
      stopped: false,
      content: [{ type: "text", key: "additional", text: "导出 PDF" }],
    },
  ];
  expect(workTurns(view)[0]).toMatchObject({
    subject: "重新设计项目报价单",
    request: "\n重新设计项目报价单\n保留价格\n导出 PDF",
  });
});

test("Work keeps every status in chronological date groups across midnight", () => {
  const { view, run } = running();
  const now = new Date(2026, 10, 24, 0, 5).getTime();
  const records = [
    ["today", "ended", new Date(2026, 10, 24, 0, 1).getTime()],
    ["yesterday", "stopped", new Date(2026, 10, 23, 23, 59).getTime()],
    ["older", "ended", new Date(2026, 10, 20, 12).getTime()],
    ["failed", "failed", new Date(2026, 10, 20, 11).getTime()],
    ["uncertain", "uncertain", new Date(2026, 10, 19, 11).getTime()],
    ["current", "running", now],
  ] as const;
  view.runs = records.map(([turnId, status, startedAt]) => ({
    ...run,
    turnId,
    status,
    startedAt,
  }));
  view.messages = records.map(([turnId]) => ({
    id: turnId,
    turnId,
    role: "user",
    stopped: false,
    content: [],
  }));
  view.messages.push({
    id: "undated",
    role: "user",
    stopped: false,
    content: [],
  });
  expect(
    workGroups(workTurns(view), now).map((group) => ({
      label: group.label,
      ids: group.turns.map((turn) => turn.id),
    })),
  ).toEqual([
    { label: "今天", ids: ["current", "today"] },
    { label: "昨天", ids: ["yesterday"] },
    { label: "2026年11月20日", ids: ["older", "failed"] },
    { label: "2026年11月19日", ids: ["uncertain"] },
    { label: "时间未提供", ids: ["undated"] },
  ]);
  expect(workGroups([], now)).toEqual([]);
});

test("Work names routine and attachment executions from their saved inputs", () => {
  const { view } = running();
  view.messages = [
    {
      id: "request",
      turnId: "turn",
      role: "user",
      stopped: false,
      content: [],
      attachments: [
        { id: "file", name: "报价单.pdf", size: 42, path: "file.pdf" },
      ],
    },
  ];
  expect(workTurns(view)[0]?.subject).toBe("报价单.pdf");
  const input = view.messages[0];
  if (!input) throw new Error("Input required");
  input.routine = {
    runId: "routine",
    title: "每日市场简报",
    scheduledAt: 1,
  };
  expect(workTurns(view)[0]?.subject).toBe("每日市场简报");
});

test("Work labels elapsed time separately from its start time", () => {
  expect(workTime(0, 42_000)).toBe("42秒");
  expect(workTime(0, 65_000)).toBe("1分05秒");
  expect(workTime(0, 2300)).toBe("2.3秒");
  expect(workTime(undefined, 42_000)).toBe("—");
});

test("Work surfaces missing tool results while retaining the confirmed native end state", () => {
  const { view, run } = running();
  run.status = "ended";
  view.messages = [
    {
      id: "call",
      turnId: "turn",
      role: "assistant",
      stopped: false,
      content: [
        {
          type: "toolCall",
          id: "tool",
          key: "tool",
          name: "read",
          arguments: {},
        },
      ],
    },
  ];
  const turn = workTurns(view)[0];
  expect(turn).toMatchObject({
    status: "ended",
    title: "执行已结束 · 结果待核对",
    issue: "uncertain",
  });
  expect(
    workGroups(workTurns(view), Date.now()).flatMap((group) => group.turns),
  ).toEqual(workTurns(view));
  view.messages.push({
    id: "result",
    turnId: "turn",
    role: "toolResult",
    toolCallId: "tool",
    toolStatus: "failed",
    stopped: false,
    content: [],
  });
  expect(workTurns(view)[0]).toMatchObject({
    status: "ended",
    title: "执行已结束",
    toolFailures: 1,
    issue: "failed",
  });
});

test("accounting warnings preserve the execution result and legacy runs stay readable", () => {
  const { view, run } = running();
  view.messages = [
    {
      id: "request",
      turnId: "turn",
      role: "user",
      content: [],
      stopped: false,
    },
  ];
  run.status = "ended";
  expect(workTurns(view)[0]?.title).toBe("执行已结束");
  run.evidence = { taskId: "1", usage: "failed" };
  expect(workTurns(view)[0]).toMatchObject({
    status: "ended",
    title: "执行已结束 · 用量入账失败",
  });
});

test.each([
  ["codex", "commandExecution", "正在运行命令"],
  ["claude", "Read", "正在读取「private-path」"],
  ["opencode", "webfetch", "正在读取网页"],
  ["pi", "read", "正在读取「private-path」"],
  ["acp", "mcp__browser__web_search", "正在调用应用工具"],
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

function toolView(
  name = "read_file",
  args: Extract<
    ChatMessage["content"][number],
    { type: "toolCall" }
  >["arguments"] = {},
) {
  const { view } = running();
  view.messages = [
    {
      id: "call",
      turnId: "turn",
      sessionId: 1,
      role: "assistant",
      stopped: false,
      content: [
        { type: "toolCall", key: "call", id: "call", name, arguments: args },
      ],
    },
  ];
  return view;
}

test("product actions use their actual parameters and keep sensitive input out of labels", () => {
  const cases: [
    string,
    Extract<ChatMessage["content"][number], { type: "toolCall" }>["arguments"],
    string,
  ][] = [
    ["get_window_state", {}, "正在读取窗口状态"],
    ["set_value", { value: "private" }, "正在填写电脑界面"],
    ["request_credentials", {}, "正在查看应用连接"],
    [
      "image_generate",
      { recoverRequestId: "saved", purpose: "avatar" },
      "正在恢复图片结果",
    ],
    [
      "read_file",
      { path: "C:\\Users\\ASUS\\work\\项目记录.md" },
      "正在读取「项目记录.md」",
    ],
    [
      "browser_agent_browser_open",
      { url: "https://user:password@example.com/private?token=secret" },
      "正在打开 example.com",
    ],
    [
      "browser_agent_browser_fill",
      { value: "password-secret" },
      "正在填写表单",
    ],
    [
      "memory_save",
      { id: "record", revision: 2, text: "private fact" },
      "正在更新记忆",
    ],
    ["memory_save", { revision: 0 }, "正在保存记忆"],
    [
      "routine_manage",
      { action: "pause", id: "routine" },
      "正在申请暂停例行任务",
    ],
    [
      "mcp_call",
      {
        id: "connection-secret",
        method: "tools/call",
        params: { name: "send_email", arguments: { token: "secret" } },
      },
      "正在调用应用工具",
    ],
    [
      "mcpToolCall",
      {
        server: "domos",
        tool: "memory_search",
        arguments: { query: "private" },
      },
      "正在查找相关记忆",
    ],
    ["arbitrary_tool", { text: "private" }, "正在使用工具"],
  ];
  for (const [name, args, expected] of cases)
    assert.equal(chatActivity(toolView(name, args))[0]?.label, expected);
});

test("every current named product tool has a deliberate activity description", () => {
  const sources = [
    "work/memory-tools.ts",
    "work/routines.ts",
    "work/skills.ts",
    "collaboration.ts",
    "harness/interactions.ts",
    "image-services.ts",
  ];
  const names = sources.flatMap((path) => {
    const text = readFileSync(
      new URL(`../../../packages/agent/src/${path}`, import.meta.url),
      "utf8",
    );
    return [...text.matchAll(/name: "([a-z_]+)",\s*description:/g)].map(
      (match) => match[1],
    );
  });
  names.push(
    "attach_file",
    "conversation_read",
    "mcp_call",
    "computer_assist",
    "computer_request_takeover",
    "query_result",
    "approve",
  );
  for (const name of names) {
    assert(name);
    assert.notEqual(
      chatActivity(toolView(name))[0]?.label,
      "正在使用工具",
      name,
    );
  }
});

test("pending calls, concurrent calls and results retain truthful activity", () => {
  const view = toolView("read_file", { path: "a.md" });
  view.messages[0]?.content.push({
    type: "toolCall",
    key: "second",
    id: "second",
    name: "web_search",
    arguments: {},
  });
  assert.equal(chatActivity(view)[0]?.label, "正在处理 2 项操作");
  view.messages.push({
    id: "result",
    turnId: "turn",
    sessionId: 1,
    role: "toolResult",
    stopped: false,
    toolCallId: "call",
    toolStatus: "done",
    content: [],
  });
  assert.equal(chatActivity(view)[0]?.label, "正在搜索网页");
  view.messages.push({
    id: "second-result",
    turnId: "turn",
    sessionId: 1,
    role: "toolResult",
    stopped: false,
    toolCallId: "second",
    toolStatus: "failed",
    content: [],
  });
  assert.equal(chatActivity(view)[0]?.label, "正在工作");
  const run = view.runs?.[0];
  assert(run);
  run.status = "ended";
  view.activity = [
    { botId: 1, executionId: "turn", sessionId: 1, processing: true },
  ];
  assert.deepEqual(chatActivity(view), []);
});

test("waits override operations and remain scoped to the execution", () => {
  const view = toolView();
  view.approvals = [
    { id: "draft", kind: "question", title: "确认", detail: "", draft: {} },
  ];
  assert.deepEqual(
    chatActivity(view).map(({ label, working }) => ({ label, working })),
    [{ label: "等你审阅草稿", working: false }],
  );
  view.approvals = [
    {
      id: "credential",
      kind: "question",
      title: "配置",
      detail: "",
      credential: {
        connectionId: "secret-id",
        revision: 1,
        mode: "secret",
        fields: [],
      },
    },
  ];
  assert.equal(chatActivity(view)[0]?.label, "等你配置应用连接");
  const run = view.runs?.[0];
  assert(run);
  run.status = "stopping";
  assert.equal(chatActivity(view)[0]?.label, "正在停止");
  assert.equal(
    executionActivity(view, {
      turnId: "other",
      sessionId: 2,
      status: "running",
    }).label,
    "正在工作",
  );
});
