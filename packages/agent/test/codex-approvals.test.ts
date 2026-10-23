import { expect, onTestFinished, test } from "vitest";
import { codexProvider } from "../src/harness/providers/codex.ts";
import type { EngineEvent } from "../src/harness/types.ts";
import { ProtocolProcess } from "./fixtures/engine-process.ts";

async function open(accountSource: "native" | "managed" = "native") {
  const process = new ProtocolProcess();
  const events: EngineEvent[] = [];
  onTestFinished(() => process.close());
  process.receive = (request) => {
    if (request.method === "thread/start")
      process.response(request, { thread: { id: "thread" } });
    else if (request.method) process.response(request, {});
  };
  const session = await codexProvider.open({
    process,
    config: { provider: "codex", model: null, accountSource },
    sessionId: null,
    instructions: "Role",
    emit: async (event) => {
      events.push(event);
    },
  });
  const request = async (params: object, id: string | number = "approval") => {
    process.frame({
      id,
      method: "mcpServer/elicitation/request",
      params: {
        threadId: "thread",
        serverName: "domos",
        ...params,
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { process, events, session, request };
}

const form = {
  mode: "form",
  message: "Allow desktop_hotkey?",
  requestedSchema: {
    type: "object",
    properties: {
      decision: {
        type: "string",
        oneOf: [
          { const: "accept", title: "Allow once" },
          { const: "decline", title: "Deny" },
        ],
      },
    },
    required: ["decision"],
  },
};

test.each(["native", "managed"] as const)(
  "Codex %s asks the user before desktop execution",
  async (source) => {
    const { process, events, session, request } = await open(source);
    await request(form, 42);
    expect(events).toContainEqual({
      type: "approval",
      approval: expect.objectContaining({
        id: "42",
        detail: expect.stringContaining("desktop_hotkey"),
        questions: [
          expect.objectContaining({
            id: "decision",
            options: [
              { id: "accept", label: "Allow once" },
              { id: "decline", label: "Deny" },
            ],
          }),
        ],
      }),
    });
    expect(process.requests.filter((r) => r.id === 42)).toEqual([]);
    await session.answer("42", {
      allow: true,
      answers: { decision: ["accept"] },
    });
    expect(process.requests).toContainEqual({
      id: 42,
      result: {
        action: "accept",
        content: { decision: "accept" },
        _meta: null,
      },
    });
    await expect(session.answer("42", { allow: true })).rejects.toThrow("失效");
    process.frame({
      method: "serverRequest/resolved",
      params: { threadId: "thread", requestId: 42 },
    });
    await expect
      .poll(() => events)
      .toContainEqual({ type: "approval_closed", id: "42" });
  },
);

test("Codex validates typed form answers and permits correction", async () => {
  const { process, events, session, request } = await open();
  await request({
    mode: "form",
    message: "Options",
    requestedSchema: {
      type: "object",
      required: ["enabled", "count", "tags"],
      properties: {
        enabled: { type: "boolean", default: false },
        count: { type: "integer", minimum: 1, maximum: 3 },
        tags: {
          type: "array",
          minItems: 1,
          items: { type: "string", enum: ["a", "b"] },
        },
        note: { type: "string", maxLength: 4 },
      },
    },
  });
  expect(events).toContainEqual({
    type: "approval",
    approval: expect.objectContaining({
      questions: expect.arrayContaining([
        expect.objectContaining({ id: "enabled", value: "false" }),
        expect.objectContaining({ id: "note", required: false }),
        expect.objectContaining({ id: "tags", multiple: true }),
      ]),
    }),
  });
  for (const answers of [
    { enabled: ["false"], count: ["9"], tags: ["a"] },
    { enabled: ["maybe"], count: ["2"], tags: ["a"] },
    { enabled: ["false"], count: ["2"], tags: ["unknown"] },
  ])
    await expect(
      session.answer("approval", { allow: true, answers }),
    ).rejects.toThrow();
  expect(process.requests.filter((r) => r.id === "approval")).toEqual([]);
  await session.answer("approval", {
    allow: true,
    answers: { enabled: ["false"], count: ["2"], tags: ["a", "b"] },
  });
  expect(process.requests).toContainEqual({
    id: "approval",
    result: {
      action: "accept",
      content: { enabled: false, count: 2, tags: ["a", "b"] },
      _meta: null,
    },
  });
});

test.each(["decline", "cancel"])(
  "Codex returns %s for an MCP confirmation",
  async (action) => {
    const { process, session, request } = await open();
    await request(form);
    if (action === "cancel") await session.interrupt();
    else await session.answer("approval", { allow: false });
    expect(process.requests).toContainEqual({
      id: "approval",
      result: { action, content: null, _meta: null },
    });
  },
);

test("Codex resolves confirmations and isolates other threads", async () => {
  const { process, events, session, request } = await open();
  await request({ ...form, threadId: "other" });
  expect(events.some((e) => e.type === "approval")).toBe(false);
  await request(form);
  process.frame({
    method: "serverRequest/resolved",
    params: { requestId: "approval", threadId: "thread" },
  });
  await expect
    .poll(() => events)
    .toContainEqual({ type: "approval_closed", id: "approval" });
  await expect(session.answer("approval", { allow: true })).rejects.toThrow(
    "失效",
  );
});

test("Codex presents a safe external authorization link", async () => {
  const { events, session, process, request } = await open();
  await request({
    mode: "url",
    message: "Sign in",
    url: "https://example.com/connect",
    elicitationId: "auth",
  });
  expect(events).toContainEqual({
    type: "approval",
    approval: expect.objectContaining({ url: "https://example.com/connect" }),
  });
  await session.answer("approval", { allow: true });
  expect(process.requests).toContainEqual({
    id: "approval",
    result: { action: "accept", content: null, _meta: null },
  });
});

test.each([
  { mode: "url", url: "javascript:alert(1)" },
  {
    mode: "form",
    requestedSchema: {
      type: "object",
      properties: { nested: { type: "object" } },
    },
  },
  { mode: "openai/userVerification" },
])(
  "Codex cancels unsupported confirmation content with a diagnostic: $mode",
  async (params) => {
    const { events, process, session, request } = await open();
    await request(params);
    expect(events.some((event) => event.type === "approval")).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === "runtime" && event.state.notices?.["codex:approval"],
      ),
    ).toBe(true);
    expect(process.requests).toContainEqual({
      id: "approval",
      result: { action: "cancel", content: null, _meta: null },
    });
    await expect(session.answer("approval", { allow: true })).rejects.toThrow(
      "失效",
    );
  },
);

test.each([
  {
    error: { message: "user rejected MCP tool call" },
    text: "user rejected MCP tool call",
  },
  {
    result: {
      isError: true,
      content: [{ type: "text", text: "Desktop unavailable" }],
    },
    text: "Desktop unavailable",
  },
])("Codex preserves MCP failure details: $text", async ({ text, ...item }) => {
  const { process, events } = await open();
  process.frame({
    method: "item/completed",
    params: {
      item: {
        id: "desktop",
        type: "mcpToolCall",
        tool: "desktop_hotkey",
        status: item.error ? "failed" : "completed",
        ...item,
      },
    },
  });
  await expect
    .poll(() => events)
    .toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        failed: true,
        text: expect.stringContaining(text),
      }),
    );
});
