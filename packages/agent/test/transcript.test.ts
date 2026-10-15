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
