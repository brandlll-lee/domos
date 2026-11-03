import { expect, test } from "vitest";
import type { ChatView } from "../src/chat-view.ts";
import type { ChatContent, ChatMessage } from "../src/messages.ts";
import { chatTranscript } from "../src/transcript.ts";

function message(
  role: ChatMessage["role"],
  turnId: string,
  content: ChatContent[],
  fields: Partial<ChatMessage> = {},
): ChatMessage {
  const id = crypto.randomUUID();
  return {
    id,
    turnId,
    role,
    stopped: false,
    content: content.map((part, index) => ({ ...part, key: `${id}:${index}` })),
    ...fields,
  };
}

function view(
  messages: ChatMessage[],
  fields: Partial<ChatView> = {},
): ChatView {
  return {
    id: 1,
    model: null,
    instructions: "",
    messages,
    draft: null,
    activeTurnId: null,
    busy: false,
    failed: false,
    tools: [],
    ...fields,
  };
}

test("complete replies arrive during work while partial text and tools stay private", () => {
  const messages = [
    message("user", "turn", [{ type: "text", text: "Prepare a report" }]),
    message(
      "assistant",
      "turn",
      [
        { type: "thinking", thinking: "Private reasoning" },
        { type: "text", text: "I will check the source." },
        {
          type: "toolCall",
          id: "call",
          name: crypto.randomUUID(),
          arguments: {},
        },
      ],
      { stopReason: "toolUse" },
    ),
    message("toolResult", "turn", [{ type: "text", text: "Private output" }], {
      toolStatus: "failed",
    }),
    message("assistant", "turn", [
      { type: "text", text: "The source is ready." },
    ]),
    message("assistant", "turn", [{ type: "text", text: "Incomplete" }], {
      pending: true,
    }),
  ];
  const original = structuredClone(messages);
  const items = chatTranscript(
    view(messages, {
      activeTurnId: "turn",
      busy: true,
      draft: message("assistant", "turn", [
        { type: "text", text: "Another draft" },
      ]),
    }),
  );
  expect(items).toMatchObject([
    { kind: "message", message: { role: "user" } },
    {
      kind: "message",
      message: {
        content: [{ type: "text", text: "I will check the source." }],
      },
    },
    {
      kind: "message",
      message: { content: [{ type: "text", text: "The source is ready." }] },
    },
  ]);
  expect(messages).toEqual(original);
});

test("complete replies survive later failure and stopped drafts stay hidden", () => {
  for (const status of ["failed", "stopped"] as const) {
    const items = chatTranscript(
      view([
        message("user", "turn", [{ type: "text", text: "Task" }]),
        message("assistant", "turn", [{ type: "text", text: "First result" }], {
          pending: false,
        }),
        message("assistant", "turn", [{ type: "text", text: "Draft" }], {
          pending: true,
          stopped: true,
        }),
        message(
          "assistant",
          "turn",
          [],
          status === "failed"
            ? { stopReason: "error", error: "Connection lost" }
            : { stopped: true, stopReason: "aborted" },
        ),
      ]),
    );
    expect(items).toMatchObject([
      { kind: "message", message: { role: "user" } },
      { kind: "message", message: { content: [{ text: "First result" }] } },
      ...(status === "failed" ? [{ kind: "notice", id: "turn", status }] : []),
    ]);
  }
});

test("task failures use the runtime error and tool errors can recover", () => {
  const messages = [
    message("user", "turn", []),
    message("toolResult", "turn", [], { toolStatus: "failed", isError: true }),
    message("assistant", "turn", [{ type: "text", text: "Recovered" }]),
  ];
  expect(chatTranscript(view(messages)).map((item) => item.kind)).toEqual([
    "message",
    "message",
  ]);
  expect(
    chatTranscript(
      view(messages, { failed: true, error: "Connection lost" }),
    ).at(-1),
  ).toEqual({
    kind: "notice",
    id: "turn",
    status: "failed",
    error: "Connection lost",
  });
  expect(
    chatTranscript(
      view(messages.slice(0, 1), { activeTurnId: "turn", busy: true }),
    ),
  ).toHaveLength(1);
});

test("saved product notices remain visible without exposing raw tool output", () => {
  const notice = { text: "已创建定时　◷　晚间简报" };
  const saved = message(
    "toolResult",
    "turn",
    [{ type: "text", text: "Raw result" }],
    { notice },
  );
  const original = structuredClone(saved);
  expect(chatTranscript(view([saved]))).toMatchObject([
    {
      kind: "message",
      id: saved.id,
      message: { role: "assistant", content: [], notice },
    },
  ]);
  expect(saved).toEqual(original);
  expect(chatTranscript(view([{ ...saved, isError: true }]))).toEqual([]);
  expect(chatTranscript(view([{ ...saved, hidden: true }]))).toEqual([]);
});

test("files arrive at task completion and stay hidden for interrupted tasks", () => {
  const file = { id: "file", name: "report.txt", size: 12, path: "report.txt" };
  const messages = [
    message("user", "turn", []),
    message("toolResult", "turn", [], { attachments: [file] }),
    message("assistant", "turn", [{ type: "text", text: "Result" }], {
      attachments: [file],
    }),
  ];
  const working = chatTranscript(
    view(messages, { activeTurnId: "turn", busy: true }),
  );
  expect(working).toMatchObject([
    { kind: "message", message: { role: "user" } },
    {
      kind: "message",
      message: { content: [{ text: "Result" }], attachments: undefined },
    },
  ]);
  const complete = chatTranscript(view(messages));
  expect(complete).toHaveLength(2);
  expect(complete[1]).toMatchObject({
    kind: "message",
    message: { attachments: [file] },
  });
  const failed = chatTranscript(view(messages, { failed: true }));
  expect(failed.some((item) => item.kind === "attachments")).toBe(false);
  expect(failed[1]).toMatchObject({ message: { attachments: undefined } });
});

test("complete product messages and questions arrive immediately", () => {
  const messages = [
    message("user", "turn", []),
    message("toolResult", "turn", [], {
      delivery: { text: "Checking sources" },
    }),
    message("toolResult", "turn", [], {
      delivery: { text: "Which folder?", kind: "question" },
    }),
  ];
  const items = chatTranscript(
    view(messages, { activeTurnId: "turn", busy: true }),
  );
  expect(items).toMatchObject([
    { kind: "message", message: { role: "user" } },
    { kind: "message", message: { content: [{ text: "Checking sources" }] } },
    { kind: "message", message: { content: [{ text: "Which folder?" }] } },
  ]);
  expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
});

test("adjacent delivered files form one gallery within their turn", () => {
  const first = { id: "first", name: "first.png", path: "first.png", size: 12 };
  const second = {
    id: "second",
    name: "second.png",
    path: "second.png",
    size: 12,
  };
  const messages = [
    message("toolResult", "turn", [], { attachments: [first] }),
    message("toolResult", "turn", [], { attachments: [second] }),
    message("assistant", "turn", [{ type: "text", text: "Images ready" }]),
    message("toolResult", "next", [], { attachments: [first] }),
    message("toolResult", "another", [], { attachments: [second] }),
  ];
  const original = structuredClone(messages);
  expect(chatTranscript(view(messages))).toMatchObject([
    { kind: "attachments", id: messages[0]?.id, files: [first, second] },
    { kind: "message" },
    { kind: "attachments", files: [first] },
    { kind: "attachments", files: [second] },
  ]);
  expect(messages).toEqual(original);
});

test("takeover cards remain visible while waiting and after expiry", () => {
  for (const state of ["waiting", "expired"] as const) {
    const card = message(
      "assistant",
      "turn",
      [{ type: "text", text: "Take over" }],
      {
        pending: state === "waiting",
        stopped: state === "expired",
        takeover: {
          id: "request",
          computerId: "bound",
          revision: 1,
          service: "browser",
          state,
        },
      },
    );
    expect(chatTranscript(view([card]))).toEqual([
      { kind: "message", id: card.id, message: card },
    ]);
  }
});

test("question and permission records remain in the transcript in all states", () => {
  for (const kind of ["question", "permission"] as const)
    for (const state of ["pending", "answered", "denied", "expired"] as const) {
      const card = message("assistant", "turn", [], {
        pending: state === "pending",
        stopped: state === "expired",
        approval: {
          request: { id: "request", kind, title: "Confirm", detail: "" },
          state,
        },
      });
      expect(chatTranscript(view([card]))).toMatchObject([
        { kind: "message", message: card },
      ]);
    }
});

test("saved questions keep their receipt order between progress and final text", () => {
  const progress = message(
    "assistant",
    "turn",
    [{ type: "text", text: "Checking" }],
    { receivedAt: 10, timestamp: 25 },
  );
  const card = message("assistant", "turn", [], {
    timestamp: 20,
    approval: {
      request: { id: "q", kind: "question", title: "Choose", detail: "" },
      state: "answered",
    },
  });
  const final = message("assistant", "turn", [{ type: "text", text: "Done" }], {
    receivedAt: 30,
    timestamp: 30,
  });
  expect(
    chatTranscript(view([card, progress, final])).map((item) => item.id),
  ).toEqual([progress.id, card.id, final.id]);
});

test("repeated file receipts appear once per turn", () => {
  const file = { id: "same", name: "report.txt", path: "report.txt", size: 1 };
  expect(
    chatTranscript(
      view([
        message("toolResult", "turn", [], { attachments: [file, file] }),
        message("toolResult", "turn", [], { attachments: [file] }),
      ]),
    ),
  ).toMatchObject([{ kind: "attachments", files: [file] }]);
});

test("routine projection hides scheduled input and quiet files but preserves questions and ordinary chat", async () => {
  const { applyRoutineDelivery } = await import(
    "../src/work/routine-delivery.ts"
  );
  const input = message("user", "monitor", [{ type: "text", text: "Check" }], {
    requestId: "run-request",
  });
  const reply = message("assistant", "monitor", [
    { type: "text", text: "Checking" },
  ]);
  const ordinary = message("user", "next", [
    { type: "text", text: "My question" },
  ]);
  const approval = message("assistant", "monitor", [], {
    approval: {
      request: {
        id: "permission",
        title: "Allow?",
        detail: "Scope",
        kind: "permission",
      },
      state: "pending",
    },
  });
  const snapshot = view([input, reply, approval, ordinary], {
    activeTurnId: "monitor",
    processing: true,
  });
  const run = {
    id: "run",
    requestId: "run-request",
    turnId: "monitor",
    title: "Check",
    scheduledAt: 123,
    delivery: "conditional",
    status: "running",
  } as import("../src/work/routine-state.ts").RoutineRun;
  applyRoutineDelivery(snapshot, [run]);
  const items = chatTranscript(snapshot);
  expect(items.map((item) => item.id)).toEqual([approval.id, ordinary.id]);
  expect(snapshot.processing).toBe(false);
  run.status = "done";
  run.delivered = true;
  run.report = {
    notify: true,
    text: "New release",
    summary: "v2",
    key: "release/v2",
  };
  snapshot.messages.push(
    message("assistant", "monitor", [{ type: "text", text: "New release" }], {
      id: "routine-result:run",
      routine: { runId: "run", title: "Check", scheduledAt: 123 },
    }),
  );
  applyRoutineDelivery(snapshot, [run]);
  applyRoutineDelivery(snapshot, [run]);
  expect(
    chatTranscript(snapshot).filter((item) => item.id === "routine-result:run"),
  ).toHaveLength(1);
  expect(
    chatTranscript(snapshot).find((item) => item.id === "routine-result:run"),
  ).toMatchObject({
    message: { routine: { title: "Check", scheduledAt: 123 } },
  });
});
