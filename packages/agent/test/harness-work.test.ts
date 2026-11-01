import { expect, onTestFinished, test } from "vitest";
import { claudeProvider } from "../src/harness/providers/claude.ts";
import { codexProvider } from "../src/harness/providers/codex.ts";
import {
  customAcpProvider,
  opencodeProvider,
} from "../src/harness/providers/opencode.ts";
import { piProvider } from "../src/harness/providers/pi.ts";
import type { EngineEvent } from "../src/harness/types.ts";
import { ProtocolProcess } from "./fixtures/engine-process.ts";
import { codexWork } from "./fixtures/native-work.ts";

function fixture() {
  const process = new ProtocolProcess();
  const events: EngineEvent[] = [];
  onTestFinished(() => process.close());
  return {
    process,
    events,
    emit: async (event: EngineEvent) => {
      events.push(event);
    },
  };
}
function records(events: EngineEvent[]) {
  return events.filter(
    (event) =>
      "id" in event &&
      ["tool", "tool_result", "message", "thinking"].includes(event.type),
  );
}

test("Codex preserves search, commands, files and agent results in live and recovered records", async () => {
  const f = fixture();
  f.process.receive = (request) => {
    if (request.method === "thread/start")
      f.process.response(request, { thread: { id: "main" } });
    else if (request.method === "turn/start") {
      f.process.response(request, { turn: { id: "turn" } });
      for (const item of codexWork) {
        f.process.frame({
          method: "item/started",
          params: { threadId: "main", item: { ...item, status: "inProgress" } },
        });
        if (item.id === "command")
          f.process.frame({
            method: "item/commandExecution/outputDelta",
            params: { threadId: "main", itemId: item.id, delta: "v24" },
          });
        f.process.frame({
          method: "item/completed",
          params: { threadId: "main", item },
        });
        if (item.id === "child") {
          f.process.frame({
            method: "item/completed",
            params: {
              threadId: "child-thread",
              item: {
                id: "child-read",
                type: "commandExecution",
                command: "pwd",
                aggregatedOutput: "/work",
                status: "completed",
              },
            },
          });
          f.process.frame({
            method: "turn/completed",
            params: {
              threadId: "child-thread",
              turn: { id: "child-turn", status: "completed" },
            },
          });
        }
      }
      f.process.frame({
        method: "turn/completed",
        params: { threadId: "main", turn: { id: "turn", status: "completed" } },
      });
    } else if (request.method === "thread/turns/list")
      f.process.response(request, {
        data: [{ id: "turn", status: "completed" }],
        nextCursor: null,
      });
    else if (request.method === "thread/items/list")
      f.process.response(request, {
        data: codexWork.map((item) => ({ item })),
        nextCursor: null,
      });
    else if (request.id !== undefined) f.process.response(request, {});
  };
  const session = await codexProvider.open({
    ...f,
    config: { provider: "codex", model: null },
    sessionId: null,
    instructions: "Role",
  });
  await session.prompt("Check sources");
  const live = records(f.events);
  expect(
    live
      .filter((event) => event.type === "tool_result" && !event.partial)
      .map((event) => ("id" in event ? event.id : "")),
  ).toEqual(["search", "command", "files", "child", "child-read"]);
  expect(live).toContainEqual(
    expect.objectContaining({
      type: "tool_result",
      id: "command",
      append: true,
      partial: true,
      receivedAt: expect.any(Number),
    }),
  );
  expect(live).toContainEqual(
    expect.objectContaining({
      type: "tool_result",
      id: "child-read",
      parentId: "child",
    }),
  );
  const boundary = f.events.length;
  expect(await session.recover?.("turn")).toBe(true);
  const recovered = records(f.events.slice(boundary));
  expect(
    recovered.map((event) => `${event.type}:${"id" in event ? event.id : ""}`),
  ).toEqual([
    "tool:search",
    "tool_result:search",
    "tool:command",
    "tool_result:command",
    "tool:files",
    "tool_result:files",
    "tool:child",
    "tool_result:child",
    "message:answer",
  ]);
  for (const event of recovered) {
    expect(event.recovered).toBe(true);
    expect(event.receivedAt).toBeUndefined();
    expect(event.timestamp).toBeUndefined();
    if (event.type !== "tool")
      expect(event.native).toEqual(
        codexWork.find((item) => "id" in event && item.id === event.id),
      );
  }
  expect(
    f.process.requests.filter((request) => request.method === "turn/start"),
  ).toHaveLength(1);
});

test("Claude retains child events, thinking and structured results through native history", async () => {
  const f = fixture();
  const frames = [
    {
      type: "user",
      uuid: "request",
      parent_tool_use_id: null,
      message: { content: "Check" },
    },
    {
      type: "assistant",
      uuid: "first",
      message: {
        id: "parent",
        content: [
          { type: "thinking", thinking: "Check sources" },
          {
            type: "tool_use",
            id: "task",
            name: "Agent",
            input: { prompt: "Read" },
          },
        ],
      },
    },
    {
      type: "assistant",
      uuid: "child",
      parent_tool_use_id: "task",
      message: {
        id: "child",
        content: [
          {
            type: "tool_use",
            id: "read",
            name: "Read",
            input: { file_path: "note.md" },
          },
        ],
      },
    },
    {
      type: "user",
      uuid: "output",
      parent_tool_use_id: "task",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "read",
            content: [{ type: "text", text: "File content" }],
            is_error: false,
          },
        ],
      },
    },
    {
      type: "assistant",
      uuid: "final",
      message: {
        id: "answer",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Confirmed" }],
      },
    },
  ];
  f.process.receive = (request) => {
    if (request.type !== "user") return;
    for (const frame of frames.slice(1)) f.process.frame(frame);
    f.process.frame({ type: "result", is_error: false });
  };
  f.process.history = async () => frames;
  const session = await claudeProvider.open({
    ...f,
    config: { provider: "claude", model: null },
    sessionId: "native",
    instructions: "Role",
  });
  await session.prompt("Check");
  expect(records(f.events)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "thinking",
        id: "parent:0",
        text: "Check sources",
      }),
      expect.objectContaining({ type: "tool", id: "read", parentId: "task" }),
      expect.objectContaining({
        type: "tool_result",
        id: "read",
        parentId: "task",
        native: frames[3]?.message.content[0],
      }),
    ]),
  );
  const boundary = f.events.length;
  expect(await session.recover?.("claude:request")).toBe(true);
  expect(
    records(f.events.slice(boundary)).map((event) => [
      event.type,
      "id" in event ? event.id : "",
      event.parentId,
    ]),
  ).toEqual(
    records(f.events.slice(0, boundary)).map((event) => [
      event.type,
      "id" in event ? event.id : "",
      event.parentId,
    ]),
  );
  expect(
    f.process.requests.filter((request) => request.type === "user"),
  ).toHaveLength(1);
});

test("Pi preserves tool progress and restores thinking and tool identities", async () => {
  const f = fixture();
  const assistant = {
    role: "assistant",
    timestamp: 10,
    stopReason: "toolUse",
    content: [
      { type: "thinking", thinking: "Read" },
      {
        type: "toolCall",
        id: "read",
        name: "read",
        arguments: { path: "note.md" },
      },
    ],
  };
  const result = {
    content: [{ type: "text", text: "Complete" }],
    details: { lines: 1 },
  };
  const answer = {
    role: "assistant",
    timestamp: 20,
    stopReason: "stop",
    content: [{ type: "text", text: "Confirmed" }],
  };
  f.process.receive = (request) => {
    f.process.frame({
      type: "response",
      id: request.id,
      success: true,
      data:
        request.type === "get_state" ? { sessionFile: "/native/session" } : {},
    });
    if (request.type !== "prompt") return;
    f.process.frame({ type: "message_start", message: assistant });
    f.process.frame({ type: "message_end", message: assistant });
    f.process.frame({
      type: "tool_execution_start",
      toolCallId: "read",
      toolName: "read",
      args: { path: "note.md" },
    });
    f.process.frame({
      type: "tool_execution_update",
      toolCallId: "read",
      toolName: "read",
      partialResult: { content: [{ type: "text", text: "Reading" }] },
    });
    f.process.frame({
      type: "tool_execution_end",
      toolCallId: "read",
      toolName: "read",
      result,
    });
    f.process.frame({ type: "message_start", message: answer });
    f.process.frame({ type: "message_end", message: answer });
    f.process.frame({ type: "agent_settled" });
  };
  f.process.history = async () => [
    {
      type: "message",
      id: "user",
      parentId: "previous",
      message: { role: "user", content: "Check" },
    },
    { type: "message", id: "assistant", parentId: "user", message: assistant },
    {
      type: "message",
      id: "tool",
      parentId: "assistant",
      message: {
        role: "toolResult",
        toolCallId: "read",
        toolName: "read",
        isError: false,
        timestamp: 15,
        ...result,
      },
    },
    { type: "message", id: "answer", parentId: "tool", message: answer },
  ];
  const session = await piProvider.open({
    ...f,
    config: { provider: "pi", model: null },
    sessionId: null,
    instructions: "Role",
  });
  await session.prompt("Check");
  expect(f.events).toContainEqual(
    expect.objectContaining({
      type: "tool_result",
      id: "read",
      partial: true,
      text: "Reading",
    }),
  );
  const boundary = f.events.length;
  expect(await session.recover?.("pi:previous")).toBe(true);
  expect(records(f.events.slice(boundary))).toEqual([
    expect.objectContaining({
      type: "thinking",
      id: "pi:10:0",
      timestamp: 10,
      recovered: true,
    }),
    expect.objectContaining({ type: "tool", id: "read", recovered: true }),
    expect.objectContaining({
      type: "tool_result",
      id: "read",
      native: result,
      recovered: true,
    }),
    expect.objectContaining({ type: "message", id: "pi:20", recovered: true }),
  ]);
  expect(
    f.process.requests.filter((request) => request.type === "prompt"),
  ).toHaveLength(1);
});

test.each([opencodeProvider, customAcpProvider])(
  "$name retains ACP patches and structured output",
  async (provider) => {
    const f = fixture();
    const output = { content: [{ type: "text", text: "Complete" }], count: 1 };
    f.process.receive = (request) => {
      if (request.method === "initialize")
        f.process.response(request, {
          protocolVersion: 1,
          agentCapabilities: { mcpCapabilities: { http: true } },
        });
      else if (request.method === "session/new")
        f.process.response(request, { sessionId: "session" });
      else if (request.method === "session/prompt") {
        for (const update of [
          {
            sessionUpdate: "tool_call",
            toolCallId: "read",
            title: "Read note.md",
            kind: "read",
            status: "pending",
            rawInput: { path: "note.md" },
            locations: [{ path: "note.md" }],
          },
          {
            sessionUpdate: "tool_call_update",
            toolCallId: "read",
            status: "in_progress",
            content: [
              { type: "content", content: { type: "text", text: "Reading" } },
            ],
          },
          {
            sessionUpdate: "tool_call_update",
            toolCallId: "read",
            status: "completed",
            rawOutput: output,
          },
        ])
          f.process.frame({
            jsonrpc: "2.0",
            method: "session/update",
            params: { sessionId: "session", update },
          });
        f.process.response(request, { stopReason: "end_turn" });
      } else if (request.id !== undefined) f.process.response(request, {});
    };
    const session = await provider.open({
      ...f,
      config: { provider: provider.id, model: null, command: "native" },
      sessionId: null,
      instructions: "Role",
    });
    await session.prompt("Read");
    const results = f.events.filter((event) => event.type === "tool_result");
    expect(results.map((event) => event.partial)).toEqual([true, true, false]);
    expect(results.at(-1)?.native).toMatchObject({
      kind: "read",
      locations: [{ path: "note.md" }],
      rawInput: { path: "note.md" },
      rawOutput: output,
      status: "completed",
    });
    if (provider.id === "opencode") {
      f.process.request = async <T>() =>
        [
          { info: { id: "baseline", role: "assistant" }, parts: [] },
          { info: { id: "user", role: "user" }, parts: [] },
          {
            info: {
              id: "answer",
              role: "assistant",
              parentID: "user",
              finish: "stop",
              time: { created: 10, completed: 20 },
            },
            parts: [
              {
                type: "tool",
                callID: "read",
                tool: "read",
                state: {
                  status: "completed",
                  input: { path: "note.md" },
                  output: "Complete",
                  time: { start: 11, end: 15 },
                },
              },
            ],
          },
        ] as T;
      const boundary = f.events.length;
      expect(await session.recover?.("opencode:baseline")).toBe(true);
      expect(f.events.slice(boundary)).toContainEqual(
        expect.objectContaining({
          type: "tool_result",
          id: "read",
          recovered: true,
          timestamp: 11,
          endedAt: 15,
          native: expect.objectContaining({ rawOutput: "Complete" }),
        }),
      );
    } else expect(provider.capabilities.recovery).toBe(false);
    expect(
      f.process.requests.filter(
        (request) => request.method === "session/prompt",
      ),
    ).toHaveLength(1);
  },
);
