import { expect, onTestFinished, test } from "vitest";
import { claudeProvider } from "../src/harness/providers/claude.ts";
import { codexProvider } from "../src/harness/providers/codex.ts";
import { opencodeProvider } from "../src/harness/providers/opencode.ts";
import { piProvider } from "../src/harness/providers/pi.ts";
import type { EngineEvent, EngineSession } from "../src/harness/types.ts";
import { ProtocolProcess } from "./fixtures/engine-process.ts";
import { featureProcess } from "./fixtures/feature-process.ts";

test("native Pi loads the tools that expose its MCP servers", async () => {
  const process = featureProcess();
  onTestFinished(() => process.close());
  const session = await piProvider.open({
    process,
    config: { provider: "pi", model: null, accountSource: "native" },
    sessionId: null,
    instructions: "Role",
    emit: async () => {},
  });
  expect(process.spec?.args).toEqual(
    expect.arrayContaining([
      "builtin:mcp",
      "builtin:codemode",
      "builtin:tool-search",
    ]),
  );
  expect((await session.controls?.())?.commands).toContainEqual({
    name: "review",
    description: "Review work",
  });
});

function protocol() {
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

test("Pi returns extension selections and cancellations to the native request", async () => {
  const { process, events, emit } = protocol();
  process.receive = (request) => {
    if (request.type === "extension_ui_response") return;
    process.frame({
      type: "response",
      id: request.id,
      success: true,
      data:
        request.type === "get_state"
          ? { sessionFile: "/work/session.jsonl" }
          : {},
    });
  };
  const session = await piProvider.open({
    process,
    config: { provider: "pi", model: null },
    sessionId: null,
    instructions: "Role",
    emit,
  });
  process.frame({
    type: "extension_ui_request",
    id: "choose",
    method: "select",
    title: "Choose target",
    options: ["Production", "Preview"],
  });
  await new Promise((resolve) => setImmediate(resolve));
  expect(events).toContainEqual({
    type: "approval",
    approval: {
      id: "choose",
      kind: "question",
      title: "Choose target",
      detail: "",
      questions: [
        {
          id: "choose",
          title: "Choose target",
          options: [
            { id: "Production", label: "Production" },
            { id: "Preview", label: "Preview" },
          ],
        },
      ],
    },
  });
  await session.answer("choose", {
    allow: true,
    answers: { choose: ["Preview"] },
  });
  expect(process.requests).toContainEqual({
    type: "extension_ui_response",
    id: "choose",
    value: "Preview",
  });
  process.frame({
    type: "extension_ui_request",
    id: "input",
    method: "input",
    title: "Name",
  });
  await new Promise((resolve) => setImmediate(resolve));
  await session.answer("input", { allow: false });
  expect(process.requests).toContainEqual({
    type: "extension_ui_response",
    id: "input",
    cancelled: true,
  });
  process.frame({
    type: "extension_ui_request",
    id: "expired",
    method: "confirm",
    title: "Confirm",
    message: "Continue?",
    timeout: 1,
  });
  await expect
    .poll(() => process.requests)
    .toContainEqual({
      type: "extension_ui_response",
      id: "expired",
      cancelled: true,
    });
  expect(events).toContainEqual({ type: "approval_closed", id: "expired" });
  expect(
    events.some(
      (event) => event.type === "approval" && event.approval.automatic,
    ),
  ).toBe(false);
});

test.each([piProvider, claudeProvider])(
  "$id accepts a live input and waits for the continued reply",
  async (provider) => {
    const { process, emit } = protocol();
    const started = Promise.withResolvers<void>();
    process.receive = (request) => {
      if (provider.id === "pi") {
        process.frame({
          type: "response",
          id: request.id,
          success: true,
          data:
            request.type === "get_state"
              ? { sessionFile: "/work/session.jsonl" }
              : {},
        });
        if (request.type === "prompt") started.resolve();
      } else if (request.type === "user") started.resolve();
    };
    const session = await provider.open({
      process,
      config: { provider: provider.id, model: null },
      sessionId: null,
      instructions: "Role",
      emit,
    });
    let settled = false;
    const run = session.prompt("first").then(() => {
      settled = true;
    });
    await started.promise;
    const delivery = session.steer?.("second");
    expect(delivery).toBeDefined();
    if (provider.id === "claude") {
      process.frame({ type: "result", queued_turn_count: 1 });
      const request = process.requests.at(-1) as unknown as { uuid: string };
      process.frame({ type: "user", uuid: request.uuid, isReplay: true });
    }
    expect(await delivery).toBe("accepted");
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    process.frame(
      provider.id === "pi"
        ? { type: "agent_settled" }
        : { type: "result", queued_turn_count: 0 },
    );
    await run;
    if (provider.id === "pi")
      expect(process.requests).toContainEqual(
        expect.objectContaining({ type: "set_steering_mode", mode: "all" }),
      );
    else expect(process.spec?.args).toContain("--replay-user-messages");
  },
);

test("Pi reconciles the recorded number of inputs without sending them again", async () => {
  const { process, events, emit } = protocol();
  let complete = true;
  process.receive = (request) =>
    process.frame({
      type: "response",
      id: request.id,
      success: true,
      data:
        request.type === "get_state"
          ? { sessionFile: "/work/session.jsonl" }
          : request.type === "get_entries"
            ? {
                leafId: "answer",
                entries: [
                  {
                    type: "message",
                    id: "request",
                    parentId: "previous",
                    message: { role: "user", content: "Work" },
                  },
                  {
                    type: "message",
                    id: "additional",
                    parentId: "request",
                    message: { role: "user", content: "Additional work" },
                  },
                  {
                    type: "message",
                    id: "answer",
                    parentId: "additional",
                    message: {
                      role: "assistant",
                      stopReason: complete ? "stop" : "toolUse",
                      content: [{ type: "text", text: "Saved result" }],
                    },
                  },
                ],
              }
            : {},
    });
  const session = await piProvider.open({
    process,
    config: { provider: "pi", model: null },
    sessionId: "/work/session.jsonl",
    instructions: "Role",
    emit,
  });
  expect(await session.recover?.("pi:previous")).toBe(false);
  expect(await session.recover?.("pi:previous", 2)).toBe(true);
  expect(events).toContainEqual({
    type: "message",
    id: "pi:1",
    text: "Saved result",
  });
  complete = false;
  expect(await session.recover?.("pi:previous")).toBe(false);
  expect(process.requests.some((request) => request.type === "prompt")).toBe(
    false,
  );
});

test("Claude reconciles the matching user UUID and refuses an unfinished turn", async () => {
  const { process, events, emit } = protocol();
  let reason = "end_turn";
  process.history = async () => [
    {
      type: "user",
      uuid: "request-uuid",
      parent_tool_use_id: null,
      message: { role: "user", content: "Work" },
    },
    {
      type: "assistant",
      uuid: "answer-uuid",
      parent_tool_use_id: null,
      message: {
        id: "native-answer",
        role: "assistant",
        stop_reason: reason,
        content: [{ type: "text", text: "Complete result" }],
      },
    },
  ];
  const session = await claudeProvider.open({
    process,
    config: { provider: "claude", model: null },
    sessionId: crypto.randomUUID(),
    instructions: "Role",
    emit,
  });
  expect(await session.recover?.("claude:request-uuid")).toBe(true);
  expect(events).toContainEqual({
    type: "message",
    id: "native-answer",
    text: "Complete result",
  });
  reason = "tool_use";
  expect(await session.recover?.("claude:request-uuid")).toBe(false);
  expect(await session.recover?.("claude:other-request")).toBe(false);
  expect(process.requests).toEqual([]);
});

test("Pi reports a command check failure before opening a session", async () => {
  const { process, emit } = protocol();
  process.launch = async () =>
    process.frame({ type: "domos_ready", error: "命令工具无法运行。" });
  await expect(
    piProvider.open({
      process,
      config: { provider: "pi", model: null },
      sessionId: null,
      instructions: "Test",
      emit,
    }),
  ).rejects.toThrow("命令工具无法运行");
  expect(process.requests).toEqual([]);
});

test("Pi waits for settlement after tool and agent-end events", async () => {
  const { process, events, emit } = protocol();
  const prompted = Promise.withResolvers<void>();
  process.receive = (request) => {
    const data =
      request.type === "get_state"
        ? { sessionFile: "/work/session.jsonl" }
        : {};
    process.frame({ type: "response", id: request.id, success: true, data });
    if (request.type === "prompt") {
      process.frame({ type: "message_start", message: { role: "assistant" } });
      process.frame({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Hello" },
      });
      process.frame({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello" }],
          stopReason: "toolUse",
        },
      });
      process.frame({
        type: "tool_execution_start",
        toolCallId: "file",
        toolName: "write",
        args: { path: "report.md" },
      });
      process.frame({ type: "agent_end" });
      prompted.resolve();
    }
  };
  const session = await piProvider.open({
    process,
    config: { provider: "pi", model: null },
    sessionId: null,
    instructions: "Role",
    emit,
  });
  let settled = false;
  const task = session.prompt("Work").then(() => {
    settled = true;
  });
  await prompted.promise;
  await new Promise((resolve) => setImmediate(resolve));
  expect(settled).toBe(false);
  expect(events).toContainEqual({ type: "message", id: "pi:1", text: "Hello" });
  process.frame({
    type: "tool_execution_end",
    toolCallId: "file",
    toolName: "write",
    result: { content: [{ type: "text", text: "Saved" }] },
  });
  process.frame({ type: "message_start", message: { role: "assistant" } });
  process.frame({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Done" }],
      stopReason: "stop",
    },
  });
  process.frame({ type: "agent_settled" });
  await task;
  expect(events).toContainEqual({ type: "message", id: "pi:2", text: "Done" });
  expect(events).toContainEqual({
    type: "tool_result",
    id: "file",
    name: "write",
    text: "Saved",
    failed: false,
  });
});

test("Codex handles approval, streams tools and recovers a completed native turn", async () => {
  const { process, events, emit } = protocol();
  let approved = false;
  process.receive = (request) => {
    if (request.id === "approval") {
      approved = (request.result as { decision: string }).decision === "accept";
      process.frame({
        method: "item/completed",
        params: {
          item: { id: "message", type: "agentMessage", text: "Saved" },
        },
      });
      process.frame({
        method: "turn/completed",
        params: { turn: { id: "turn-1", status: "completed" } },
      });
      return;
    }
    if (request.method === "thread/start" || request.method === "thread/resume")
      process.response(request, { thread: { id: "thread-1" } });
    else if (request.method === "turn/start") {
      process.response(request, { turn: { id: "turn-1" } });
      process.frame({
        id: "approval",
        method: "item/commandExecution/requestApproval",
        params: { command: "write report.md" },
      });
    } else if (request.method === "thread/read")
      process.response(request, {
        thread: {
          turns: [
            {
              id: "turn-1",
              status: "completed",
              items: [{ id: "message", type: "agentMessage", text: "Saved" }],
            },
          ],
        },
      });
    else if (request.id !== undefined) process.response(request, {});
  };
  let session: EngineSession;
  session = await codexProvider.open({
    process,
    config: { provider: "codex", model: null },
    sessionId: null,
    instructions: "Role",
    emit: async (event) => {
      await emit(event);
      if (event.type === "approval") {
        expect(event.approval.automatic).toBe(true);
        await session.answer(event.approval.id, { allow: true });
      }
    },
  });
  await session.prompt("Save report");
  expect(approved).toBe(true);
  expect(events).toContainEqual({ type: "accepted", id: "turn-1" });
  expect(await session.recover?.("turn-1")).toBe(true);
  expect(await session.recover?.("unknown")).toBe(false);
  expect(
    process.requests.filter((request) => request.method === "turn/start"),
  ).toHaveLength(1);
  expect(
    process.requests.find((request) => request.method === "thread/start")
      ?.params,
  ).toMatchObject({ cwd: "/work/bots/1", approvalPolicy: "on-request" });
});

test.each(["managed", "native"] as const)(
  "Claude uses %s accounts and keeps its own session",
  async (accountSource) => {
    const { process, events, emit } = protocol();
    process.receive = (request) => {
      if (request.type !== "user") return;
      process.frame({
        type: "stream_event",
        event: { type: "message_start", message: { id: "message" } },
      });
      process.frame({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Saved" },
        },
      });
      process.frame({
        type: "assistant",
        message: {
          id: "message",
          content: [
            { type: "text", text: "Saved" },
            {
              type: "tool_use",
              id: "write",
              name: "Write",
              input: { file_path: "report.md" },
            },
          ],
        },
      });
      process.frame({
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "write", content: "Done" },
          ],
        },
      });
      process.frame({ type: "result", is_error: false });
    };
    const session = await claudeProvider.open({
      process,
      config: { provider: "claude", model: null, accountSource },
      sessionId: "native-session",
      instructions: "Role",
      emit,
    });
    await session.prompt("Save report");
    expect(session.id).toBe("native-session");
    expect(process.spec?.accountSource).toBe(accountSource);
    if (accountSource === "native") {
      expect(process.spec?.env).not.toHaveProperty("CLAUDE_CONFIG_DIR");
      expect(process.spec?.args).toContain("--setting-sources");
    }
    expect(process.spec?.args).toContain("--resume");
    expect(process.spec?.args).toContain("mcp__domos__approve");
    expect(events).toContainEqual({
      type: "tool_result",
      id: "write",
      name: "Claude Code",
      text: "Done",
      failed: false,
    });
    expect(events).toContainEqual({
      type: "text",
      id: "message",
      text: "Saved",
    });
    expect(events).toContainEqual({
      type: "message",
      id: "message",
      text: "Saved",
    });
  },
);

test.each(["managed", "native"] as const)(
  "Claude reports retries, resumes output and preserves %s connection errors",
  async (accountSource) => {
    const { process, events, emit } = protocol();
    const session = await claudeProvider.open({
      process,
      config: { provider: "claude", model: null, accountSource },
      sessionId: null,
      instructions: "Role",
      emit,
    });
    const pending = session.prompt("Hello").catch((error: unknown) => error);
    await expect
      .poll(() =>
        events.some(
          (event) => event.type === "accepted" && event.ready !== false,
        ),
      )
      .toBe(true);
    process.frame({
      type: "system",
      subtype: "api_retry",
      attempt: 3,
      max_retries: 10,
      retry_delay_ms: 2408,
      error_status: null,
    });
    await expect
      .poll(() => events)
      .toContainEqual({
        type: "runtime",
        state: {
          processing: false,
          retry: "模型连接失败，正在重试（3/10，间隔 3 秒）。",
        },
      });
    process.frame({
      type: "stream_event",
      event: { type: "message_start", message: { id: "message" } },
    });
    await expect
      .poll(() => events)
      .toContainEqual({
        type: "runtime",
        state: { processing: true, retry: null },
      });
    process.frame({
      type: "result",
      is_error: true,
      errors: ["Connection refused (ECONNREFUSED)"],
    });
    expect(await pending).toMatchObject({
      message: "Connection refused (ECONNREFUSED)",
    });
    expect(events.at(-1)).toEqual({
      type: "runtime",
      state: { processing: false, retry: null },
    });
  },
);

test("OpenCode uses ACP model discovery, permissions and native session load", async () => {
  const { process, events, emit } = protocol();
  let promptId: string | number | undefined;
  process.request = async <T>() => [] as T;
  process.receive = (request) => {
    if (request.id === "permission") {
      process.frame({
        jsonrpc: "2.0",
        id: promptId,
        result: { stopReason: "end_turn" },
      });
      return;
    }
    if (request.method === "initialize")
      process.response(request, {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true },
      });
    else if (request.method === "session/load")
      process.response(request, {
        configOptions: [
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "test/model",
            options: [{ value: "test/model", name: "Test" }],
          },
        ],
      });
    else if (request.method === "session/set_config_option")
      process.response(request, { configOptions: [] });
    else if (request.method === "session/prompt") {
      promptId = request.id;
      process.frame({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "session-1",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Saved" },
          },
        },
      });
      process.frame({
        jsonrpc: "2.0",
        id: "permission",
        method: "session/request_permission",
        params: {
          sessionId: "session-1",
          toolCall: { toolCallId: "file", title: "Write report" },
          options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
        },
      });
    }
  };
  let session: EngineSession;
  session = await opencodeProvider.open({
    process,
    config: { provider: "opencode", model: "test/model" },
    sessionId: "session-1",
    instructions: "Role",
    emit: async (event) => {
      await emit(event);
      if (event.type === "approval")
        await session.answer(event.approval.id, { allow: true });
    },
  });
  expect(await session.models()).toEqual([{ id: "test/model", name: "Test" }]);
  await session.prompt("Save report");
  expect(events).toContainEqual({
    type: "text",
    id: "opencode:1",
    text: "Saved",
  });
  expect(
    process.requests.find((request) => request.id === "permission")?.result,
  ).toEqual({ outcome: { outcome: "selected", optionId: "allow" } });
  expect(events).toContainEqual({
    type: "approval",
    approval: expect.objectContaining({ automatic: true }),
  });
});

test("OpenCode reconciles native history after its saved checkpoint", async () => {
  const { process, events, emit } = protocol();
  let finish = "stop";
  process.request = async <T>() =>
    [
      {
        info: {
          id: "baseline",
          role: "assistant",
          finish: "stop",
          time: { completed: 1 },
        },
        parts: [],
      },
      { info: { id: "user", role: "user" }, parts: [] },
      {
        info: {
          id: "result",
          role: "assistant",
          parentID: "user",
          finish,
          time: { completed: 2 },
        },
        parts: [{ type: "text", text: "Recovered answer" }],
      },
    ] as T;
  process.receive = (request) =>
    process.response(
      request,
      request.method === "initialize"
        ? { protocolVersion: 1, agentCapabilities: { loadSession: true } }
        : {},
    );
  const session = await opencodeProvider.open({
    process,
    config: { provider: "opencode", model: null },
    sessionId: "session-1",
    instructions: "Role",
    emit,
  });
  expect(await session.recover?.("opencode:baseline")).toBe(true);
  expect(events).toContainEqual({
    type: "message",
    id: "result",
    text: "Recovered answer",
  });
  finish = "tool-calls";
  expect(await session.recover?.("opencode:baseline")).toBe(false);
  expect(
    process.requests.some((request) => request.method === "session/prompt"),
  ).toBe(false);
});
