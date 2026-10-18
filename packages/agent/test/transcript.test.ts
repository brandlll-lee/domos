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

test("a tool call and its result form one step while the final answer stays visible", () => {
  const turnId = crypto.randomUUID();
  const callId = crypto.randomUUID();
  const name = crypto.randomUUID();
  const messages = [
    message("user", turnId, [{ type: "text", text: "Prepare a report" }]),
    message(
      "assistant",
      turnId,
      [
        { type: "text", text: "Checking the source" },
        { type: "toolCall", id: callId, name, arguments: { source: "input" } },
      ],
      { stopReason: "toolUse" },
    ),
    message("toolResult", turnId, [{ type: "text", text: "Source content" }], {
      toolCallId: callId,
      toolStatus: "done",
    }),
    message("assistant", turnId, [{ type: "text", text: "Report ready" }], {
      stopReason: "stop",
    }),
  ];
  const original = structuredClone(messages);
  const items = chatTranscript(view(messages));
  expect(items.map((item) => item.kind)).toEqual([
    "message",
    "activity",
    "message",
  ]);
  expect(items[1]).toMatchObject({
    status: "done",
    steps: [
      { type: "text", text: "Checking the source" },
      {
        type: "tool",
        name,
        status: "done",
        output: [{ text: "Source content" }],
      },
    ],
  });
  expect(items[2]).toMatchObject({
    message: { content: [{ text: "Report ready" }] },
  });
  expect(messages).toEqual(original);
});

test("input identity separates turns even when a provider repeats a call ID", () => {
  const callId = crypto.randomUUID();
  const messages = ["first", "second"].flatMap((turnId) => [
    message("user", turnId, []),
    message(
      "assistant",
      turnId,
      [
        {
          type: "toolCall",
          id: callId,
          name: crypto.randomUUID(),
          arguments: {},
        },
      ],
      { stopReason: "toolUse" },
    ),
    message("toolResult", turnId, [{ type: "text", text: turnId }], {
      toolCallId: callId,
      toolStatus: "done",
    }),
  ]);
  const activities = chatTranscript(view(messages)).filter(
    (item) => item.kind === "activity",
  );
  expect(activities).toHaveLength(2);
  expect(activities.map((item) => item.steps)).toMatchObject([
    [{ output: [{ text: "first" }] }],
    [{ output: [{ text: "second" }] }],
  ]);
});

test("thinking and interrupted narration stay in the process while the answer stays outside", () => {
  const turnId = crypto.randomUUID();
  const items = chatTranscript(
    view([
      message("user", turnId, []),
      message(
        "assistant",
        turnId,
        [
          { type: "thinking", thinking: "Check the data" },
          { type: "text", text: "Answer" },
        ],
        { stopReason: "stop" },
      ),
    ]),
  );
  expect(items.map((item) => item.kind)).toEqual([
    "message",
    "activity",
    "message",
  ]);
  expect(items[1]).toMatchObject({
    steps: [{ type: "thinking", text: "Check the data" }],
  });
  expect(items[2]).toMatchObject({
    message: { content: [{ type: "text", text: "Answer" }] },
  });
  const stopped = chatTranscript(
    view([
      message("user", turnId, []),
      message(
        "assistant",
        turnId,
        [{ type: "text", text: "Partial progress" }],
        { stopped: true, stopReason: "aborted" },
      ),
    ]),
  );
  expect(stopped[1]).toMatchObject({
    status: "stopped",
    steps: [{ text: "Partial progress" }],
  });
});

test("live work uses runtime state and completed text chats have no empty process", () => {
  const turnId = crypto.randomUUID();
  const user = message("user", turnId, []);
  expect(
    chatTranscript(view([user], { activeTurnId: turnId, busy: true }))[1],
  ).toMatchObject({ status: "running", steps: [] });
  expect(chatTranscript(view([user]))).toHaveLength(1);
  const callId = crypto.randomUUID();
  const tool = message("assistant", turnId, [
    { type: "toolCall", id: callId, name: crypto.randomUUID(), arguments: {} },
  ]);
  expect(
    chatTranscript(
      view([user, tool], {
        activeTurnId: turnId,
        busy: true,
        tools: [{ callId, status: "running", output: "Live output" }],
      }),
    )[1],
  ).toMatchObject({
    status: "running",
    steps: [{ status: "running", liveOutput: "Live output" }],
  });
});

test("draft text never becomes a reply and draft thinking stays in the live process", () => {
  const turnId = crypto.randomUUID();
  const user = message("user", turnId, [{ type: "text", text: "Question" }]);
  const draft = message("assistant", turnId, [
    { type: "thinking", thinking: "Checking facts" },
    { type: "text", text: "Partial answer" },
  ]);
  const items = chatTranscript(
    view([user], {
      draft,
      activeTurnId: turnId,
      busy: true,
    }),
  );
  expect(items).toMatchObject([
    { kind: "message", message: user },
    {
      kind: "activity",
      status: "running",
      responding: true,
      steps: [{ type: "thinking", text: "Checking facts" }],
    },
  ]);
  expect(items.filter((item) => item.kind === "message")).toHaveLength(1);
  expect(chatTranscript(view([user], { failed: true }))).toMatchObject([
    { kind: "message" },
    { kind: "activity", status: "failed" },
  ]);
});

test("an active engine turn delivers its answer and files together after completion", () => {
  const turnId = "report";
  const file = { id: "file", name: "report.txt", size: 12, path: "report.txt" };
  const messages = [
    message("user", turnId, [{ type: "text", text: "Prepare a report" }]),
    message("toolResult", turnId, [], { attachments: [file] }),
    message("assistant", turnId, [{ type: "text", text: "Report ready" }]),
  ];
  const active = chatTranscript(
    view(messages, { activeTurnId: turnId, busy: true }),
  );
  expect(active.filter((item) => item.kind === "message")).toHaveLength(1);
  expect(active.some((item) => item.kind === "attachments")).toBe(false);
  expect(active.find((item) => item.kind === "activity")).toMatchObject({
    status: "running",
    responding: true,
    steps: expect.arrayContaining([
      { type: "text", id: expect.any(String), text: "Report ready" },
    ]),
  });
  const complete = chatTranscript(view(messages));
  expect(complete.find((item) => item.kind === "attachments")).toMatchObject({
    files: [file],
  });
  expect(complete.at(-1)).toMatchObject({
    kind: "message",
    message: { content: [{ text: "Report ready" }] },
  });
});

test("stopped and failed answers remain in the process with their files", () => {
  const file = { id: "file", name: "draft.txt", size: 12, path: "draft.txt" };
  const messages = [
    message("user", "turn", [{ type: "text", text: "Prepare a report" }]),
    message("toolResult", "turn", [], { attachments: [file] }),
    message("assistant", "turn", [{ type: "text", text: "Unfinished answer" }]),
  ];
  for (const fields of [{ failed: true, error: "Connection lost" }, {}]) {
    const input = structuredClone(messages);
    const answer = input.at(-1);
    if (!fields.failed && answer) answer.stopped = true;
    const items = chatTranscript(view(input, fields));
    expect(items.filter((item) => item.kind === "message")).toHaveLength(1);
    expect(items.some((item) => item.kind === "attachments")).toBe(false);
    expect(items.find((item) => item.kind === "activity")).toMatchObject({
      status: fields.failed ? "failed" : "stopped",
      steps: expect.arrayContaining([
        { type: "attachments", id: input[1]?.id, files: [file] },
        { type: "text", id: expect.any(String), text: "Unfinished answer" },
      ]),
    });
  }
});

test("questions arrive during work while progress messages wait for completion", () => {
  const messages = [
    message("user", "turn", [{ type: "text", text: "Prepare a report" }]),
    message("toolResult", "turn", [], {
      delivery: { text: "Checking sources" },
    }),
    message("toolResult", "turn", [], {
      delivery: { text: "Which folder should I use?", kind: "question" },
    }),
  ];
  const active = chatTranscript(
    view(messages, { activeTurnId: "turn", busy: true }),
  );
  expect(
    active.flatMap((item) =>
      item.kind === "message" && item.message.role === "assistant"
        ? item.message.content.map((part) => part.type === "text" && part.text)
        : [],
    ),
  ).toEqual(["Which folder should I use?"]);
  expect(
    chatTranscript(view(messages)).filter((item) => item.kind === "message"),
  ).toHaveLength(3);
});
