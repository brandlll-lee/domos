import { expect, onTestFinished, test, vi } from "vitest";
import { EngineRequestRejected, JsonLines } from "../src/harness/json-lines.ts";
import { claudeProvider } from "../src/harness/providers/claude.ts";
import { codexProvider } from "../src/harness/providers/codex.ts";
import { openCodexClient } from "../src/harness/providers/codex-client.ts";
import {
  customAcpProvider,
  opencodeProvider,
} from "../src/harness/providers/opencode.ts";
import { piProvider } from "../src/harness/providers/pi.ts";
import type { EngineEvent, EngineSession } from "../src/harness/types.ts";
import { priceUsage } from "../src/harness/usage-cost.ts";
import { ProtocolProcess } from "./fixtures/engine-process.ts";
import { featureProcess } from "./fixtures/feature-process.ts";

test.each([
  { tools: [] },
  { tools: ["browser_agent_browser_click", "get_window_state"] },
])("Codex uses the mounted Domos GUI surface: %j", async ({ tools }) => {
  const process = new ProtocolProcess();
  Object.defineProperty(process, "ready", {
    value: Promise.resolve({ ...(await process.ready), tools }),
  });
  process.receive = (request) => process.response(request, {});
  await openCodexClient(process, { provider: "codex", model: null });
  expect(process.spec?.args?.includes("features.browser_use=false")).toBe(
    tools.length > 0,
  );
  expect(process.spec?.args?.includes("features.computer_use=false")).toBe(
    tools.length > 0,
  );
});

test.each([null, "/native/session"])(
  "Pi selects its native session (%s)",
  async (sessionId) => {
    const process = featureProcess();
    onTestFinished(() => process.close());
    const session = await piProvider.open({
      process,
      config: { provider: "pi", model: null },
      sessionId,
      instructions: "Role",
      emit: async () => {},
    });
    expect(process.spec?.args).toEqual(
      expect.arrayContaining(["--mode", "rpc"]),
    );
    expect(
      process.requests.filter((request) => request.type === "new_session"),
    ).toEqual([]);
    expect(
      process.requests.filter((request) => request.type === "switch_session"),
    ).toEqual(
      sessionId ? [expect.objectContaining({ sessionPath: sessionId })] : [],
    );
    expect((await session.controls?.())?.commands).toContainEqual({
      name: "review",
      description: "Review work",
    });
  },
);

test.each([true, false])(
  "RPC timeout identifies the request and phase (Pi: %s)",
  async (pi) => {
    const { process } = protocol();
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const rpc = new JsonLines(process, pi);
    const result = rpc.request("get_state").catch((error) => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await result).message).toMatch(
      /初始化.*get_state.*30000ms.*未收到原生响应/,
    );
  },
);

test.each([
  "Native model unavailable",
  { code: -32000, message: "Native model unavailable" },
])("RPC retains the native rejection message (%j)", async (error) => {
  const { process } = protocol();
  process.receive = (request) =>
    process.frame({ id: request.id, type: "response", success: false, error });
  const rpc = new JsonLines(process, true);
  const failure = await rpc.request("set_model").catch((error) => error);
  expect(failure).toBeInstanceOf(EngineRequestRejected);
  expect(failure.message).toMatch(
    /初始化.*set_model.*\d+ms.*Native model unavailable/,
  );
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

test("Pi exports compaction text with retained chat and the native boundary", async () => {
  const { process, events, emit } = protocol();
  process.receive = (request) => {
    const data =
      request.type === "get_state"
        ? { sessionFile: "/native/session" }
        : request.type === "compact"
          ? {
              summary:
                "Goal: review files. Constraint: do not install dependencies.",
              firstKeptEntryId: "native-kept",
              tokensBefore: 12000,
            }
          : request.type === "get_messages"
            ? {
                messages: [
                  {
                    role: "compactionSummary",
                    summary:
                      "Goal: review files. Constraint: do not install dependencies.",
                  },
                  {
                    role: "user",
                    content: "Cancel the deployment. Review only.",
                  },
                  {
                    role: "assistant",
                    content: [
                      { type: "thinking", thinking: "private" },
                      { type: "text", text: "Review pending." },
                    ],
                  },
                  {
                    role: "toolResult",
                    content: [{ type: "text", text: "window=old-handle" }],
                  },
                ],
              }
            : {};
    process.frame({ type: "response", id: request.id, success: true, data });
  };
  const session = await piProvider.open({
    process,
    emit,
    config: { provider: "pi", model: null },
    sessionId: null,
    instructions: "Role",
  });
  await session.compact?.();
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "compaction",
      status: "completed",
      summary: {
        text: "Goal: review files. Constraint: do not install dependencies.",
        nativeBoundary: "native-kept",
        retained: [
          { role: "user", text: "Cancel the deployment. Review only." },
          { role: "assistant", text: "Review pending." },
        ],
      },
    }),
  );
});

test.each(["ask", "auto", "full"] as const)(
  "Codex applies %s permissions on start, resume and each turn",
  async (approvalMode) => {
    const { process, emit } = protocol();
    process.receive = (request) => {
      if (
        request.method === "thread/start" ||
        request.method === "thread/resume"
      )
        process.response(request, { thread: { id: "thread" } });
      else if (request.method === "turn/start") {
        process.response(request, { turn: { id: "turn" } });
        process.frame({
          jsonrpc: "2.0",
          method: "turn/completed",
          params: { turn: { id: "turn", status: "completed" } },
        });
      } else process.response(request, {});
    };
    for (const sessionId of [null, "thread"]) {
      const session = await codexProvider.open({
        process,
        config: { provider: "codex", model: null, approvalMode },
        sessionId,
        instructions: "Role",
        emit,
      });
      await session.prompt("Work");
    }
    for (const request of process.requests.filter(
      (item) =>
        item.method === "thread/start" ||
        item.method === "thread/resume" ||
        item.method === "turn/start",
    )) {
      expect(request.params).toMatchObject({
        approvalPolicy: approvalMode === "full" ? "never" : "on-request",
        approvalsReviewer: approvalMode === "auto" ? "auto_review" : "user",
        ...(request.method === "turn/start"
          ? {
              sandboxPolicy: {
                type:
                  approvalMode === "full"
                    ? "dangerFullAccess"
                    : "workspaceWrite",
              },
            }
          : {
              sandbox:
                approvalMode === "full"
                  ? "danger-full-access"
                  : "workspace-write",
            }),
      });
    }
  },
);

test.each([
  ["ask", "default"],
  ["edits", "acceptEdits"],
  ["auto", "auto"],
  ["full", "bypassPermissions"],
] as const)("Claude maps %s to native %s", async (approvalMode, native) => {
  const { process, emit } = protocol();
  await claudeProvider.open({
    process,
    config: { provider: "claude", model: null, approvalMode },
    sessionId: "session",
    instructions: "Role",
    emit,
  });
  expect(process.spec?.args).toEqual(
    expect.arrayContaining(["--permission-mode", native]),
  );
});

test("ACP uses stdio when HTTP MCP is unavailable", async () => {
  const { process, emit } = protocol();
  Object.defineProperty(process, "ready", {
    value: Promise.resolve({
      ...(await process.ready),
      mcpStdio: {
        command: "/work/node",
        args: ["/work/mcp-stdio.mjs"],
        env: [],
      },
    }),
  });
  process.receive = (request) =>
    process.response(
      request,
      request.method === "initialize"
        ? { protocolVersion: 1 }
        : { sessionId: "session" },
    );
  await customAcpProvider.open({
    process,
    config: { provider: "acp", model: null, command: "agent" },
    sessionId: null,
    instructions: "Role",
    mcp: { servers: [{ name: "docs", url: "http://127.0.0.1/docs" }] },
    emit,
  });
  expect(
    process.requests.find((request) => request.method === "session/new")?.params
      ?.mcpServers,
  ).toEqual([
    {
      name: "domos",
      command: "/work/node",
      args: ["/work/mcp-stdio.mjs", (await process.ready).url],
      env: [],
    },
    {
      name: "docs",
      command: "/work/node",
      args: ["/work/mcp-stdio.mjs", "http://127.0.0.1/docs"],
      env: [],
    },
  ]);
});

test.each(["ask", "full"] as const)(
  "OpenCode applies %s permissions to its native process",
  async (approvalMode) => {
    const { process, emit } = protocol();
    process.receive = (request) =>
      process.response(
        request,
        request.method === "initialize"
          ? {
              protocolVersion: 1,
              agentCapabilities: { mcpCapabilities: { http: true } },
            }
          : { sessionId: "session" },
      );
    await opencodeProvider.open({
      process,
      config: { provider: "opencode", model: null, approvalMode },
      sessionId: null,
      instructions: "Role",
      emit,
    });
    expect(
      JSON.parse(process.spec?.env?.OPENCODE_CONFIG_CONTENT ?? "{}").permission,
    ).toBe(approvalMode === "full" ? "allow" : "ask");
  },
);

test("custom ACP handles permission during session setup and advertises native choices", async () => {
  const { process, emit } = protocol();
  let opening: (typeof process.requests)[number] | undefined;
  process.receive = (request) => {
    if (request.method === "initialize")
      process.response(request, {
        protocolVersion: 1,
        agentCapabilities: { mcpCapabilities: { http: true } },
      });
    else if (request.method === "session/new") {
      opening = request;
      process.frame({
        jsonrpc: "2.0",
        id: "permission",
        method: "session/request_permission",
        params: {
          sessionId: "custom-session",
          toolCall: { toolCallId: "read", title: "Read workspace" },
          options: [{ optionId: "allow", name: "Allow", kind: "allow_always" }],
        },
      });
    } else if (request.id === "permission" && opening) {
      expect(request.result).toEqual({
        outcome: { outcome: "selected", optionId: "allow" },
      });
      process.response(opening, {
        sessionId: "custom-session",
        configOptions: [
          {
            id: "model",
            category: "model",
            name: "Model",
            type: "select",
            currentValue: "native-model",
            options: [{ value: "native-model", name: "Native model" }],
          },
        ],
      });
    }
  };
  const session = await customAcpProvider.open({
    process,
    config: {
      provider: "acp",
      model: null,
      command: "/native/example",
      args: ["--acp"],
    },
    sessionId: null,
    instructions: "Role",
    emit,
    approve: async (approval) => {
      expect(approval.detail).toBe("Read workspace");
      return { allow: true };
    },
  });
  expect(await session.models()).toEqual([
    { id: "native-model", name: "Native model" },
  ]);
  expect(process.spec).toMatchObject({
    command: "/native/example",
    args: ["--acp"],
  });
  expect(process.spec?.http).toBeUndefined();
  expect(await session.skills?.()).toBeUndefined();
  expect(customAcpProvider.capabilities.recovery).toBe(false);
});

test.each(["/work/session.jsonl"])(
  "Pi stops a cancelled session selection (%s) before publishing a session",
  async (sessionId) => {
    const { process, events, emit } = protocol();
    process.receive = (request) =>
      process.frame({
        type: "response",
        id: request.id,
        success: true,
        data: { cancelled: true },
      });
    await expect(
      piProvider.open({
        process,
        config: { provider: "pi", model: null },
        sessionId,
        instructions: "Role",
        emit,
      }),
    ).rejects.toThrow("切换已取消");
    expect(
      events.some(
        (event) => event.type === "session" || event.type === "accepted",
      ),
    ).toBe(false);
  },
);

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
  expect(events).toContainEqual(
    expect.objectContaining({
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
            allowOther: true,
            options: [
              { id: "Production", label: "Production" },
              { id: "Preview", label: "Preview" },
            ],
          },
        ],
      },
    }),
  );
  await session.answer("choose", {
    allow: true,
    answers: { choose: ["Custom target"] },
  });
  expect(process.requests).toContainEqual({
    type: "extension_ui_response",
    id: "choose",
    value: "Custom target",
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
  expect(events).toContainEqual(
    expect.objectContaining({ type: "approval_closed", id: "expired" }),
  );
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
          : {},
    });
  process.history = async () => [
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
        timestamp: 1,
        content: [{ type: "text", text: "Saved result" }],
      },
    },
  ];
  const session = await piProvider.open({
    process,
    config: { provider: "pi", model: null },
    sessionId: "/work/session.jsonl",
    instructions: "Role",
    emit,
  });
  expect(await session.recover?.("pi:previous")).toBe(false);
  expect(await session.recover?.("pi:previous", 2)).toBe(true);
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "message",
      id: "pi:1",
      text: "Saved result",
    }),
  );
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
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "message",
      id: "native-answer",
      text: "Complete result",
    }),
  );
  reason = "tool_use";
  expect(await session.recover?.("claude:request-uuid")).toBe(false);
  expect(await session.recover?.("claude:other-request")).toBe(false);
  expect(process.requests).toEqual([]);
});

test("Pi reports a command check failure before opening a session", async () => {
  const { process, emit } = protocol();
  process.launch = async () => {
    throw new Error("命令工具无法运行。");
  };
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
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "message",
      id: "pi:1",
      text: "Hello",
      receivedAt: expect.any(Number),
    }),
  );
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
      content: [],
      stopReason: "error",
      errorMessage: "Connection error.",
    },
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
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "message",
      id: "pi:3",
      text: "Done",
      receivedAt: expect.any(Number),
    }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "tool_result",
      id: "file",
      name: "write",
      text: "Saved",
      failed: false,
      receivedAt: expect.any(Number),
    }),
  );
  process.receive = (request) => {
    process.frame({
      type: "response",
      id: request.id,
      success: true,
      data: {},
    });
    if (request.type !== "prompt") return;
    process.frame({
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "Connection error.",
      },
    });
    process.frame({ type: "agent_settled" });
  };
  await expect(session.prompt("Next task")).rejects.toThrow(
    "Connection error.",
  );
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
        method: "turn/plan/updated",
        params: { plan: [{ step: "Read", status: "inProgress" }] },
      });
      process.frame({
        method: "item/completed",
        params: {
          item: {
            id: "progress",
            type: "agentMessage",
            text: "I will save it.",
          },
        },
      });
      process.frame({
        id: "approval",
        method: "item/commandExecution/requestApproval",
        params: { command: "write report.md" },
      });
    } else if (request.method === "thread/turns/list")
      process.response(request, {
        data: [{ id: "turn-1", status: "completed" }],
        nextCursor: null,
      });
    else if (request.method === "thread/items/list")
      process.response(request, {
        data: [
          { item: { id: "message", type: "agentMessage", text: "Saved" } },
        ],
        nextCursor: null,
      });
    else if (request.id !== undefined) process.response(request, {});
  };
  let session: EngineSession;
  session = await codexProvider.open({
    process,
    config: { provider: "codex", model: null },
    sessionId: null,
    mcp: {
      servers: [{ name: "acceptance", url: "http://127.0.0.1/acceptance" }],
    },
    instructions: "Role",
    emit: async (event) => {
      await emit(event);
      if (event.type === "approval") {
        expect(events.filter((event) => event.type === "message")).toEqual([
          expect.objectContaining({ id: "progress", text: "I will save it." }),
        ]);
        expect(event.approval.automatic).toBe(true);
        await session.answer(event.approval.id, { allow: true });
      }
    },
  });
  expect(process.spec?.args).toContain(
    'mcp_servers.acceptance.url="http://127.0.0.1/acceptance"',
  );
  await session.prompt("Save report");
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "plan",
      plan: [{ step: "Read", status: "inProgress" }],
    }),
  );
  expect(approved).toBe(true);
  expect(events.filter((event) => event.type === "message")).toEqual([
    expect.objectContaining({ id: "progress", text: "I will save it." }),
    expect.objectContaining({ id: "message", text: "Saved" }),
  ]);
  expect(events).toContainEqual(
    expect.objectContaining({ type: "accepted", id: "turn-1" }),
  );
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

test("Claude retains resolved models and matches their native effort controls", async () => {
  const { process, emit } = protocol();
  const levels = ["low", "medium", "high", "xhigh", "max"];
  const models = [
    {
      value: "sonnet",
      resolvedModel: "claude-sonnet-5-5",
      displayName: "Sonnet",
      description: "Sonnet 5.5 · Efficient for routine tasks",
      supportedEffortLevels: levels,
    },
    {
      value: "haiku",
      resolvedModel: "claude-haiku-4-5-20251001",
      displayName: "Haiku",
    },
    {
      value: "claude-fable-5-1",
      resolvedModel: "claude-fable-5-1",
      displayName: "Fable",
    },
  ];
  process.receive = (request) => {
    if (request.type !== "control_request") return;
    process.frame({
      type: "control_response",
      response: {
        request_id: (request as unknown as { request_id: string }).request_id,
        subtype: "success",
        response: { models, skills: [] },
      },
    });
  };
  const session = await claudeProvider.open({
    process,
    config: {
      provider: "claude",
      model: "sonnet",
      options: { effort: "high" },
    },
    sessionId: null,
    instructions: "Role",
    emit,
  });
  const catalog = await session.models();
  expect(catalog[0]).toMatchObject({
    id: "sonnet",
    name: "Sonnet · claude-sonnet-5-5",
    effort: {
      options: levels.map((id) => ({ id, label: id })),
    },
  });
  expect(catalog[1]).toMatchObject({
    id: "haiku",
    name: "Haiku · claude-haiku-4-5-20251001",
    effort: { options: [] },
  });
  expect(catalog[2]?.name).toBe("Fable · claude-fable-5-1");
  process.frame({
    type: "system",
    subtype: "init",
    model: "claude-sonnet-5-5",
  });
  const controls = await session.controls?.();
  expect(controls?.options.find((item) => item.id === "effort")).toMatchObject({
    value: "high",
    options: levels.map((id) => ({ id, label: id })),
  });
  expect(process.spec?.args).toEqual(
    expect.arrayContaining(["--model", "sonnet", "--effort", "high"]),
  );
});

test("Claude uses the work computer account and keeps its own session", async () => {
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
        delta: { type: "text_delta", text: "I will save it." },
      },
    });
    process.frame({
      type: "assistant",
      message: {
        id: "message",
        content: [
          { type: "text", text: "I will save it." },
          {
            type: "tool_use",
            id: "write",
            name: "Write",
            input: { file_path: "report.md" },
          },
        ],
      },
    });
  };
  const session = await claudeProvider.open({
    process,
    config: { provider: "claude", model: null },
    sessionId: "native-session",
    instructions: "Role",
    emit,
  });
  const run = session.prompt("Save report");
  await vi.waitFor(() =>
    expect(events.filter((event) => event.type === "message")).toEqual([
      expect.objectContaining({ id: "message", text: "I will save it." }),
    ]),
  );
  process.frame({
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: "write", content: "Done" }],
    },
  });
  process.frame({
    type: "assistant",
    message: { id: "final", content: [{ type: "text", text: "Saved" }] },
  });
  process.frame({ type: "result", is_error: false });
  await run;
  expect(session.id).toBe("native-session");
  expect(process.spec?.env?.CLAUDE_CONFIG_DIR).toBeUndefined();
  expect(process.spec?.args).toContain("--resume");
  expect(process.spec?.args).toContain("mcp__domos__approve");
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "tool_result",
      id: "write",
      name: "Claude Code",
      text: "Done",
      failed: false,
    }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "text",
      id: "message",
      text: "I will save it.",
    }),
  );
  expect(events.filter((event) => event.type === "message")).toEqual([
    expect.objectContaining({ id: "message", text: "I will save it." }),
    expect.objectContaining({ id: "final", text: "Saved" }),
  ]);
});

test("Claude reports retries, resumes output and preserves connection errors", async () => {
  const { process, events, emit } = protocol();
  const session = await claudeProvider.open({
    process,
    config: { provider: "claude", model: null },
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
    .toContainEqual(
      expect.objectContaining({
        type: "runtime",
        state: {
          processing: false,
          retry: "模型连接失败，正在重试（3/10，间隔 3 秒）。",
        },
      }),
    );
  process.frame({
    type: "stream_event",
    event: { type: "message_start", message: { id: "message" } },
  });
  await expect
    .poll(() => events)
    .toContainEqual(
      expect.objectContaining({
        type: "runtime",
        state: { processing: true, retry: null },
      }),
    );
  process.frame({
    type: "result",
    is_error: true,
    errors: ["Connection refused (ECONNREFUSED)"],
  });
  expect(await pending).toMatchObject({
    message: "Connection refused (ECONNREFUSED)",
  });
  expect(events.at(-1)).toMatchObject({
    type: "runtime",
    state: { processing: false, retry: null },
  });
});

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
        agentCapabilities: {
          loadSession: true,
          mcpCapabilities: { http: true },
        },
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
  const chunk = events.find((event) => event.type === "text");
  if (!chunk || !("id" in chunk))
    throw new Error("Missing OpenCode text chunk");
  expect(chunk).toMatchObject({ id: expect.any(String), text: "Saved" });
  expect(events.filter((event) => event.type === "message")).toEqual([
    expect.objectContaining({ id: chunk.id, text: "Saved" }),
  ]);
  expect(
    process.requests.find((request) => request.id === "permission")?.result,
  ).toEqual({ outcome: { outcome: "selected", optionId: "allow" } });
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "approval",
      approval: expect.objectContaining({ automatic: true }),
    }),
  );
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
        ? {
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: true,
              mcpCapabilities: { http: true },
            },
          }
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
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "message",
      id: "result",
      text: "Recovered answer",
    }),
  );
  finish = "tool-calls";
  expect(await session.recover?.("opencode:baseline")).toBe(false);
  expect(
    process.requests.some((request) => request.method === "session/prompt"),
  ).toBe(false);
});

test("Pi and Codex expose native skill metadata without treating other commands as skills", async () => {
  const pi = featureProcess();
  onTestFinished(() => pi.close());
  const receive = pi.receive;
  pi.receive = (request) => {
    if (request.type === "get_commands")
      pi.frame({
        type: "response",
        id: request.id,
        success: true,
        data: {
          commands: [
            {
              name: "skill:report",
              source: "skill",
              description: "Prepare report",
              sourceInfo: {
                scope: "project",
                path: "/work/skills/report/SKILL.md",
              },
            },
            { name: "review", source: "extension" },
            { name: "prompt", source: "prompt" },
          ],
        },
      });
    else receive(request);
  };
  const session = await piProvider.open({
    process: pi,
    config: { provider: "pi", model: null },
    sessionId: null,
    instructions: "Role",
    emit: async () => {},
  });
  expect(await session.skills?.()).toEqual([
    {
      name: "report",
      description: "Prepare report",
      source: "project",
      path: "/work/skills/report/SKILL.md",
    },
  ]);
  const codex = protocol();
  codex.process.nativeSkills = [
    {
      name: "report",
      scope: "USER",
      path: "/work/.codex/skills/report/SKILL.md",
      enabled: true,
    },
    { name: "disabled", enabled: false },
  ];
  codex.process.receive = (request) =>
    codex.process.response(
      request,
      request.method === "thread/start" ? { thread: { id: "catalog" } } : {},
    );
  const native = await codexProvider.open({
    process: codex.process,
    config: { provider: "codex", model: null },
    sessionId: null,
    instructions: "Role",
    emit: codex.emit,
  });
  expect(await native.skills?.()).toEqual([
    {
      name: "report",
      source: "USER",
      path: "/work/.codex/skills/report/SKILL.md",
    },
  ]);
});

test.each([-32601, -32603])(
  "Codex inspection retains account and models when skills/list returns %s",
  async (code) => {
    const process = new ProtocolProcess();
    onTestFinished(() => process.close());
    const response = process.response.bind(process);
    process.response = (request, result) => {
      if (request.method === "skills/list")
        process.frame({
          jsonrpc: "2.0",
          id: request.id,
          error: { code, message: "Catalog unavailable" },
        });
      else response(request, result);
    };
    process.receive = (request) =>
      response(
        request,
        request.method === "account/read"
          ? { account: { type: "chatgpt" } }
          : request.method === "model/list"
            ? { data: [{ id: "native-model", isDefault: true }] }
            : {},
      );
    const result = await codexProvider.inspect?.({
      process,
      config: { provider: "codex", model: null },
    });
    if (!result) throw new Error("Codex inspection is required");
    expect(result.authenticated).toBe(true);
    expect(result.models).toContainEqual(
      expect.objectContaining({ id: "native-model" }),
    );
    expect(result.controls.options.length).toBeGreaterThan(0);
    expect(result.controls.skills).toBeUndefined();
    if (code === -32601)
      expect(result.controls.notices?.skills).toBeUndefined();
    else
      expect(result.controls.notices?.skills).toContain("Catalog unavailable");
  },
);

test.each([piProvider, codexProvider, claudeProvider])(
  "$id distinguishes an empty skill catalog from a failed read",
  async (provider) => {
    const process =
      provider.id === "pi" ? featureProcess() : protocol().process;
    onTestFinished(() => process.close());
    let failed = false;
    const receive = process.receive;
    const response = process.response.bind(process);
    process.response = (request, result) => {
      if (request.method === "skills/list" && failed)
        process.frame({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32603, message: "Catalog unavailable" },
        });
      else response(request, result);
    };
    process.receive = (request) => {
      const control = request as typeof request & {
        request_id?: string;
        request?: { subtype: string };
      };
      if (control.request?.subtype === "reload_skills")
        process.frame({
          type: "control_response",
          response: {
            request_id: control.request_id,
            subtype: failed ? "error" : "success",
            error: "Catalog unavailable",
            response: { skills: [] },
          },
        });
      else if (control.request?.subtype === "initialize")
        process.frame({
          type: "control_response",
          response: {
            request_id: control.request_id,
            subtype: "success",
            response: { models: [], commands: [] },
          },
        });
      else if (request.type === "get_commands" && failed)
        process.frame({
          type: "response",
          id: request.id,
          success: false,
          error: "Catalog unavailable",
        });
      else if (provider.id === "codex")
        response(request, { thread: { id: "catalog" } });
      else receive(request);
    };
    const session = await provider.open({
      process,
      config: { provider: provider.id, model: null },
      sessionId: null,
      instructions: "Role",
      emit: async () => {},
    });
    expect(await session.skills?.()).toEqual([]);
    failed = true;
    await expect(session.skills?.()).rejects.toThrow("Catalog unavailable");
    await expect(session.controls?.()).resolves.toMatchObject({
      compact: true,
    });
  },
);

test("Claude reads its native skill catalog", async () => {
  const claude = protocol();
  claude.process.receive = (request) => {
    const control = request as typeof request & {
      request_id?: string;
      request?: { subtype: string };
    };
    if (control.request?.subtype === "reload_skills")
      claude.process.frame({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: control.request_id,
          response: {
            skills: [{ name: "report", description: "Prepare report" }],
          },
        },
      });
  };
  const session = await claudeProvider.open({
    process: claude.process,
    config: { provider: "claude", model: null },
    sessionId: null,
    instructions: "Role",
    emit: claude.emit,
  });
  expect(await session.skills?.()).toEqual([
    { name: "report", description: "Prepare report", source: "claude" },
  ]);
});

test.each([null, "retained-session"])(
  "Claude projects cumulative money as turn deltas (%s)",
  async (sessionId) => {
    const { process, events, emit } = protocol();
    const session = await claudeProvider.open({
      process,
      config: { provider: "claude", model: null },
      sessionId,
      instructions: "Role",
      emit,
    });
    for (const [uuid, total] of [
      ["a", 2],
      ["b", 5],
      ["c", 1],
    ] as const) {
      const started = Promise.withResolvers<void>();
      process.receive = (request) => {
        if (request.type === "user") started.resolve();
      };
      const turn = session.prompt("Work");
      await started.promise;
      const frame = {
        type: "result",
        uuid,
        total_cost_usd: total,
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      };
      process.frame(frame);
      await turn;
    }
    const usage = events
      .filter((event) => event.type === "usage")
      .map((event) => event.usage);
    expect(usage.map((row) => row.costUsd)).toEqual([
      sessionId ? null : 2,
      3,
      1,
    ]);
    expect(usage.map((row) => row.costCumulative)).toEqual([2, 5, 1]);
    expect(new Set(usage.map((row) => row.costCounter)).size).toBe(1);
  },
);

test.each([undefined, 10])(
  "Codex retains native cache-write counts and their protocol default (%s)",
  async (cacheWriteInputTokens) => {
    const { process, events, emit } = protocol();
    process.receive = (request) => {
      process.response(
        request,
        request.method === "thread/start"
          ? {
              thread: { id: "thread" },
              modelProvider: "openai",
              model: "gpt-6.1-terra",
            }
          : request.method === "turn/start"
            ? { turn: { id: "turn" } }
            : {},
      );
      if (request.method === "turn/start") {
        process.frame({
          method: "thread/tokenUsage/updated",
          params: {
            threadId: "thread",
            turnId: "turn",
            tokenUsage: {
              total: {
                inputTokens: 1000,
                cachedInputTokens: 200,
                outputTokens: 100,
                ...(cacheWriteInputTokens === undefined
                  ? {}
                  : { cacheWriteInputTokens }),
              },
            },
          },
        });
        process.frame({
          method: "turn/completed",
          params: {
            threadId: "thread",
            turn: { id: "turn", status: "completed" },
          },
        });
      }
    };
    const session = await codexProvider.open({
      process,
      config: { provider: "codex", model: null },
      sessionId: null,
      instructions: "Role",
      emit,
    });
    await session.prompt("Work");
    const event = events.find((event) => event.type === "usage");
    if (event?.type !== "usage") throw new Error("Usage required");
    expect(event.usage.cacheWrite).toBe(cacheWriteInputTokens ?? 0);
    expect(priceUsage(event.usage, "codex").costBasis).toBe("estimated");
  },
);
