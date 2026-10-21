import { expect, onTestFinished, test } from "vitest";
import { claudeProvider } from "../src/harness/providers/claude.ts";
import { codexProvider } from "../src/harness/providers/codex.ts";
import { opencodeProvider } from "../src/harness/providers/opencode.ts";
import { piProvider } from "../src/harness/providers/pi.ts";
import type { EngineEvent } from "../src/harness/types.ts";
import { ProtocolProcess } from "./fixtures/engine-process.ts";

test("Pi exposes native controls, compacts and reports response usage", async () => {
  const process = new ProtocolProcess();
  onTestFinished(() => process.close());
  const events: EngineEvent[] = [];
  process.receive = (request) => {
    const data =
      request.type === "get_state"
        ? {
            sessionFile: "/session",
            thinkingLevel: "medium",
            autoCompactionEnabled: true,
          }
        : request.type === "get_available_thinking_levels"
          ? { levels: ["low", "medium"] }
          : request.type === "get_commands"
            ? {
                commands: [
                  {
                    name: "review",
                    description: "Review work",
                    source: "extension",
                  },
                ],
              }
            : {};
    process.frame({ type: "response", id: request.id, success: true, data });
    if (request.type === "prompt") {
      process.frame({ type: "message_start", message: { role: "assistant" } });
      process.frame({
        type: "message_end",
        message: {
          role: "assistant",
          timestamp: 100,
          provider: "anthropic",
          model: "native-model",
          content: [],
          stopReason: "stop",
          usage: {
            input: 10,
            output: 4,
            cacheRead: 3,
            cacheWrite: 2,
            cost: { total: 0.03 },
          },
        },
      });
      process.frame({ type: "agent_settled" });
    }
  };
  const session = await piProvider.open({
    process,
    config: { provider: "pi", model: null, options: { thinkingLevel: "low" } },
    sessionId: null,
    instructions: "Role",
    emit: async (event) => {
      events.push(event);
    },
  });
  const controls = await session.controls?.();
  expect(controls?.options).toContainEqual({
    id: "thinkingLevel",
    kind: "effort",
    label: "推理强度",
    value: "medium",
    options: [
      { id: "low", label: "low" },
      { id: "medium", label: "medium" },
    ],
  });
  expect(controls?.commands).toContainEqual({
    name: "review",
    description: "Review work",
  });
  await session.prompt("Work");
  expect(events).toContainEqual({
    type: "usage",
    usage: {
      id: "pi:100",
      source: "pi.message_end",
      provider: "anthropic",
      model: "native-model",
      input: 10,
      output: 4,
      cacheRead: 3,
      cacheWrite: 2,
      costUsd: 0.03,
    },
  });
  await session.compact?.();
  expect(process.requests).toContainEqual(
    expect.objectContaining({ type: "compact" }),
  );
  expect(process.requests).toContainEqual(
    expect.objectContaining({ type: "set_thinking_level", level: "low" }),
  );
  expect(events).toContainEqual({
    type: "runtime",
    state: { compaction: "completed" },
  });
});

test("OpenCode uses advertised configuration and commands and records native message usage", async () => {
  const process = new ProtocolProcess();
  onTestFinished(() => process.close());
  const events: EngineEvent[] = [];
  let finished = false;
  process.request = async <T>() =>
    (finished
      ? [
          {
            info: {
              id: "message",
              role: "assistant",
              modelID: "model",
              providerID: "provider",
              cost: 0.01,
              tokens: { input: 8, output: 3, cache: { read: 2, write: 1 } },
            },
            parts: [],
          },
        ]
      : []) as T;
  process.receive = (request) => {
    if (request.method === "initialize")
      process.response(request, { protocolVersion: 1 });
    if (request.method === "session/new") {
      process.response(request, {
        sessionId: "session",
        configOptions: [
          {
            id: "reasoning",
            name: "Reasoning",
            category: "thought_level",
            type: "select",
            currentValue: "low",
            options: [{ value: "high", name: "High" }],
          },
        ],
      });
      process.frame({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "session",
          update: {
            sessionUpdate: "available_commands_update",
            availableCommands: [
              { name: "compact", description: "Compact context" },
            ],
          },
        },
      });
    }
    if (request.method === "session/set_config_option")
      process.response(request, { configOptions: [] });
    if (request.method === "session/prompt") {
      finished = true;
      process.frame({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "session",
          update: { sessionUpdate: "usage_update", used: 80, size: 1000 },
        },
      });
      process.response(request, { stopReason: "end_turn" });
    }
  };
  const session = await opencodeProvider.open({
    process,
    config: {
      provider: "opencode",
      model: null,
      options: { reasoning: "high" },
    },
    sessionId: null,
    instructions: "Role",
    emit: async (event) => {
      events.push(event);
    },
  });
  expect((await session.controls?.())?.commands).toContainEqual({
    name: "compact",
    description: "Compact context",
  });
  expect(process.requests).toContainEqual(
    expect.objectContaining({
      method: "session/set_config_option",
      params: { sessionId: "session", configId: "reasoning", value: "high" },
    }),
  );
  await session.prompt("Work");
  expect(events).toContainEqual({
    type: "runtime",
    state: { contextTokens: 80, contextWindow: 1000 },
  });
  expect(events).toContainEqual({
    type: "usage",
    usage: {
      id: "message",
      source: "opencode.message",
      provider: "provider",
      model: "model",
      input: 8,
      output: 3,
      cacheRead: 2,
      cacheWrite: 1,
      costUsd: 0.01,
    },
  });
  await session.compact?.();
  expect(process.requests).toContainEqual(
    expect.objectContaining({
      method: "session/prompt",
      params: {
        sessionId: "session",
        prompt: [{ type: "text", text: "/compact" }],
      },
    }),
  );
});

test("Claude uses native advertised effort and keeps cost scope and compaction boundaries", async () => {
  const process = new ProtocolProcess();
  onTestFinished(() => process.close());
  const events: EngineEvent[] = [];
  let modelUsage: Record<string, { contextWindow: number }> = {
    model: { contextWindow: 1000 },
  };
  process.receive = (request) => {
    const control = request as unknown as {
      request_id: string;
      request?: { subtype: string };
    };
    if (control.request?.subtype === "initialize")
      process.frame({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: control.request_id,
          response: {
            models: [{ value: "model", supportedEffortLevels: ["high"] }],
            commands: [{ name: "compact", description: "Compact context" }],
          },
        },
      });
    if (request.type === "user") {
      if (request.message?.content === "/compact")
        process.frame({
          type: "system",
          subtype: "compact_boundary",
          compact_metadata: { trigger: "manual" },
        });
      process.frame({
        type: "result",
        uuid: "result",
        usage: {
          input_tokens: 10,
          output_tokens: 4,
          cache_read_input_tokens: 2,
        },
        modelUsage,
        total_cost_usd: 0.02,
      });
    }
  };
  const session = await claudeProvider.open({
    process,
    config: {
      provider: "claude",
      model: "model",
      options: { effort: "high", permissionMode: "plan" },
    },
    sessionId: "session",
    instructions: "Role",
    emit: async (event) => {
      events.push(event);
    },
  });
  expect(await session.models()).toEqual([{ id: "model", name: "model" }]);
  expect((await session.controls?.())?.options).toContainEqual({
    id: "effort",
    kind: "effort",
    label: "推理强度",
    value: "high",
    options: [{ id: "high", label: "high" }],
  });
  expect(process.spec?.args).toEqual(
    expect.arrayContaining([
      "--effort",
      "high",
      "--permission-mode",
      "plan",
      "--append-subagent-system-prompt-file",
    ]),
  );
  await session.prompt("Work");
  expect(events).toContainEqual({
    type: "usage",
    usage: {
      id: "claude:result",
      source: "claude.result",
      provider: null,
      model: "model",
      input: 10,
      output: 4,
      cacheRead: 2,
      cacheWrite: null,
      costUsd: 0.02,
      costScope: "session",
    },
  });
  await session.compact?.();
  expect(events).toContainEqual({
    type: "runtime",
    state: { compaction: "completed" },
  });
  modelUsage = {
    model: { contextWindow: 1000 },
    helper: { contextWindow: 2000 },
  };
  await session.prompt("Continue");
  expect(events.filter((event) => event.type === "usage").at(-1)).toMatchObject(
    { usage: { model: null, costScope: "session" } },
  );
});

test("Codex exposes model effort, preserves each answer and replaces usage snapshots", async () => {
  const process = new ProtocolProcess();
  onTestFinished(() => process.close());
  const events: EngineEvent[] = [];
  process.receive = (request) => {
    if (request.method === "initialize") process.response(request, {});
    if (request.method === "thread/resume")
      process.response(request, {
        thread: { id: "thread" },
        modelProvider: "openai",
      });
    if (request.method === "model/list")
      process.response(request, {
        data: [
          {
            id: "model",
            isDefault: true,
            supportedReasoningEfforts: [
              { reasoningEffort: "high", description: "Deep" },
            ],
          },
        ],
      });
    if (request.method === "collaborationMode/list")
      process.response(request, {
        data: [
          {
            name: "Plan",
            mode: "plan",
            model: "model",
            reasoning_effort: "high",
          },
        ],
      });
    if (request.method === "turn/start") {
      process.response(request, { turn: { id: "turn" } });
      process.frame({
        method: "thread/tokenUsage/updated",
        params: {
          threadId: "thread",
          turnId: "previous",
          tokenUsage: {
            total: { inputTokens: 5, outputTokens: 2, cachedInputTokens: 1 },
          },
        },
      });
      process.frame({
        method: "thread/tokenUsage/updated",
        params: {
          threadId: "thread",
          turnId: "turn",
          tokenUsage: {
            total: { inputTokens: 15, outputTokens: 6, cachedInputTokens: 3 },
            last: { inputTokens: 10 },
            modelContextWindow: 1000,
          },
        },
      });
      process.frame({
        method: "turn/completed",
        params: { turn: { id: "turn", status: "completed" } },
      });
    }
  };
  const session = await codexProvider.open({
    process,
    config: {
      provider: "codex",
      model: "model",
      options: { effort: "high", mode: "plan" },
    },
    sessionId: "thread",
    instructions: "Role",
    emit: async (event) => {
      events.push(event);
    },
  });
  expect((await session.controls?.())?.options).toContainEqual({
    id: "effort",
    kind: "effort",
    label: "推理强度",
    value: "high",
    options: [{ id: "high", label: "Deep" }],
  });
  process.frame({
    id: 900,
    method: "item/tool/requestUserInput",
    params: {
      questions: [
        {
          id: "one",
          question: "First?",
          options: [{ label: "A", description: "Choice A" }],
        },
        { id: "two", question: "Second?" },
      ],
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  await session.answer("900", {
    allow: true,
    answers: { one: ["A"], two: ["B"] },
  });
  expect(process.requests).toContainEqual({
    id: 900,
    result: { answers: { one: { answers: ["A"] }, two: { answers: ["B"] } } },
  });
  process.frame({
    id: 901,
    method: "item/tool/requestUserInput",
    params: { questions: [{ id: "cancelled", question: "Continue?" }] },
  });
  process.frame({
    method: "serverRequest/resolved",
    params: { threadId: "thread", requestId: 901 },
  });
  await new Promise((resolve) => setImmediate(resolve));
  expect(events).toContainEqual({ type: "approval_closed", id: "901" });
  await expect(session.answer("901", { allow: true })).rejects.toThrow("失效");
  await session.prompt("Work");
  expect(process.requests).toContainEqual(
    expect.objectContaining({
      method: "turn/start",
      params: expect.objectContaining({ effort: "high" }),
    }),
  );
  expect(process.requests).toContainEqual(
    expect.objectContaining({
      method: "turn/start",
      params: expect.objectContaining({
        collaborationMode: {
          mode: "plan",
          settings: {
            model: "model",
            reasoning_effort: "high",
            developer_instructions: null,
          },
        },
      }),
    }),
  );
  expect(events).toContainEqual({
    type: "usage",
    usage: {
      id: "codex:usage",
      source: "codex.thread/tokenUsage/updated",
      provider: "openai",
      model: "model",
      input: 10,
      output: 4,
      cacheRead: 2,
      cacheWrite: null,
      costUsd: null,
    },
  });
  expect(events).toContainEqual({
    type: "runtime",
    state: { contextTokens: 10, contextWindow: 1000 },
  });
});
