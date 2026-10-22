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
  let thinkingLevel = "medium";
  let tokens: number | null = 80;
  process.receive = (request) => {
    if (request.type === "compact") tokens = null;
    if (request.type === "set_thinking_level")
      thinkingLevel = String(
        (request as typeof request & { level: string }).level,
      );
    const data =
      request.type === "get_state"
        ? {
            sessionFile: "/session",
            thinkingLevel,
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
            : request.type === "get_session_stats"
              ? { contextUsage: { tokens, contextWindow: 1000 } }
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
    value: "low",
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
  expect(
    events.filter((event) => event.type === "context").at(-1),
  ).toMatchObject({ tokens: null, window: 1000, estimated: true });
  expect(process.requests).toContainEqual(
    expect.objectContaining({ type: "compact" }),
  );
  expect(process.requests).toContainEqual(
    expect.objectContaining({ type: "set_thinking_level", level: "low" }),
  );
  expect(events).toContainEqual({
    type: "compaction",
    status: "completed",
  });
});

test.each(["managed", "native"] as const)(
  "OpenCode %s uses advertised configuration and commands and records native message usage",
  async (accountSource) => {
    const process = new ProtocolProcess();
    onTestFinished(() => process.close());
    const events: EngineEvent[] = [];
    let finished = false;
    let compacted = false;
    let proof = true;
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
            ...(compacted && proof
              ? [
                  {
                    info: { id: "compact-user", role: "user" },
                    parts: [{ type: "compaction" }],
                  },
                  {
                    info: {
                      id: "compact-summary",
                      role: "assistant",
                      parentID: "compact-user",
                      summary: true,
                      finish: "stop",
                    },
                    parts: [],
                  },
                ]
              : []),
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
        compacted ||= JSON.stringify(request.params?.prompt).includes(
          "/compact",
        );
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
        accountSource,
        options: { reasoning: "high" },
      },
      sessionId: null,
      instructions: "Role",
      emit: async (event) => {
        events.push(event);
      },
    });
    expect(process.spec?.accountSource).toBe(accountSource);
    if (accountSource === "native") {
      expect(process.spec?.env).not.toHaveProperty("XDG_CONFIG_HOME");
      expect(process.spec?.env).not.toHaveProperty("XDG_DATA_HOME");
    }
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
      type: "context",
      tokens: 80,
      window: 1000,
      source: "opencode.acp.usage_update",
      basis: "window",
      estimated: false,
      model: null,
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
    expect(events).toContainEqual({
      type: "compaction",
      status: "completed",
      nativeId: "compact-summary",
    });
    expect(await session.recoverCompaction?.("opencode:message")).toBe(true);
    expect(await session.recoverCompaction?.("opencode:other")).toBe(false);
    proof = false;
    expect(await session.recoverCompaction?.("opencode:message")).toBe(false);
    await expect(session.compact?.()).rejects.toThrow("结果未确认");
    expect(process.requests).toContainEqual(
      expect.objectContaining({
        method: "session/prompt",
        params: {
          sessionId: "session",
          prompt: [{ type: "text", text: "/compact" }],
        },
      }),
    );
  },
);

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
      else {
        process.frame({
          type: "assistant",
          message: {
            id: "main",
            model: "model",
            content: [],
            usage: {
              input_tokens: 5,
              cache_read_input_tokens: 11,
              cache_creation_input_tokens: 7,
            },
          },
        });
        process.frame({
          type: "assistant",
          parent_tool_use_id: "helper",
          message: {
            id: "child",
            model: "helper",
            content: [],
            usage: { input_tokens: 900 },
          },
        });
        process.frame({
          type: "system",
          subtype: "compact_boundary",
          parent_tool_use_id: "helper",
          compact_metadata: { trigger: "auto", pre_tokens: 900 },
        });
      }
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
  expect(
    events.filter((event) => event.type === "context").at(-1),
  ).toMatchObject({
    tokens: 23,
    window: 1000,
    basis: "last-input",
    model: "model",
  });
  expect(events.filter((event) => event.type === "compaction")).toHaveLength(0);
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
  expect(
    events.filter((event) => event.type === "context").at(-1),
  ).toMatchObject({ tokens: null, window: 1000 });
  expect(events).toContainEqual({
    type: "compaction",
    status: "completed",
    trigger: "manual",
    beforeTokens: undefined,
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
    type: "context",
    tokens: 10,
    window: 1000,
    source: "codex.thread/tokenUsage/updated",
    basis: "last-input",
    estimated: false,
    model: "model",
  });
});

test("Codex compaction waits for its native boundary and recovers only the matching completed turn", async () => {
  const process = new ProtocolProcess();
  onTestFinished(() => process.close());
  const events: EngineEvent[] = [];
  let boundary = true;
  process.receive = (request) => {
    if (request.method === "thread/resume")
      process.response(request, { thread: { id: "thread" } });
    else if (request.method === "thread/compact/start")
      process.response(request, {});
    else if (request.method === "thread/read")
      process.response(request, {
        thread: {
          turns: [
            {
              id: "compact-turn",
              status: "completed",
              items: boundary
                ? [{ type: "contextCompaction", id: "boundary" }]
                : [],
            },
          ],
        },
      });
    else if (request.id !== undefined) process.response(request, {});
  };
  const session = await codexProvider.open({
    process,
    config: { provider: "codex", model: null },
    sessionId: "thread",
    instructions: "Role",
    emit: async (event) => {
      events.push(event);
    },
  });
  let finished = false;
  const compact = session.compact?.().then(() => {
    finished = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  expect(finished).toBe(false);
  process.frame({
    method: "turn/started",
    params: {
      threadId: "thread",
      turn: { id: "compact-turn", status: "inProgress" },
    },
  });
  process.frame({
    method: "item/started",
    params: {
      threadId: "thread",
      item: { type: "contextCompaction", id: "boundary" },
    },
  });
  process.frame({
    method: "item/completed",
    params: {
      threadId: "thread",
      item: { type: "contextCompaction", id: "boundary" },
    },
  });
  process.frame({
    method: "turn/completed",
    params: {
      threadId: "thread",
      turn: { id: "compact-turn", status: "completed" },
    },
  });
  await compact;
  expect(finished).toBe(true);
  expect(events).toContainEqual({
    type: "accepted",
    id: "compact-turn",
    ready: false,
  });
  expect(await session.recoverCompaction?.("compact-turn")).toBe(true);
  expect(await session.recoverCompaction?.("another-turn")).toBe(false);
  boundary = false;
  expect(await session.recoverCompaction?.("compact-turn")).toBe(false);
});
