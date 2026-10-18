import { Readable, Writable } from "node:stream";
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type RequestPermissionRequest,
} from "@agentclientprotocol/sdk";
import {
  type EngineAnswer,
  type EngineOpen,
  type EngineProvider,
  engineLimits,
} from "../types.ts";

export const opencodeProvider: EngineProvider = {
  id: "opencode",
  name: "OpenCode",
  command: "opencode",
  package: "opencode-ai@1.19.0",
  login: ["auth", "login"],
  capabilities: { approvals: true, models: true, recovery: false },
  async open({
    process,
    config,
    sessionId,
    instructions,
    emit,
    env,
  }: EngineOpen) {
    const ready = await process.ready;
    let sequence = 0;
    let active = false;
    let messageId = "";
    const pending = new Map<
      string,
      {
        request: RequestPermissionRequest;
        answer: (value: EngineAnswer) => void;
      }
    >();
    const rpc = new ClientSideConnection(
      () => ({
        async requestPermission(request) {
          const id = `permission:${++sequence}`;
          const result = Promise.withResolvers<EngineAnswer>();
          pending.set(id, { request, answer: result.resolve });
          const timer = setTimeout(
            () => result.resolve({ allow: false }),
            engineLimits.approvalMs,
          );
          timer.unref();
          try {
            await emit({
              type: "approval",
              approval: {
                id,
                title: "允许这次操作？",
                detail:
                  request.toolCall.title ??
                  JSON.stringify(request.toolCall.rawInput ?? {}),
                kind: "permission",
              },
            });
            const answer = await result.promise;
            const option = request.options.find(
              (item) =>
                item.kind === (answer.allow ? "allow_once" : "reject_once"),
            );
            return {
              outcome: option
                ? { outcome: "selected", optionId: option.optionId }
                : { outcome: "cancelled" },
            };
          } finally {
            clearTimeout(timer);
            pending.delete(id);
          }
        },
        async sessionUpdate({ update }) {
          if (!active) return;
          if (
            (update.sessionUpdate === "agent_message_chunk" ||
              update.sessionUpdate === "agent_thought_chunk") &&
            update.content.type === "text"
          )
            await emit({
              type:
                update.sessionUpdate === "agent_message_chunk"
                  ? "text"
                  : "thinking",
              id: messageId,
              text: update.content.text,
            });
          if (update.sessionUpdate === "tool_call")
            await emit({
              type: "tool",
              id: update.toolCallId,
              name: update.title,
              input: (update.rawInput ?? {}) as Record<string, unknown>,
            });
          if (
            update.sessionUpdate === "tool_call_update" &&
            ["completed", "failed"].includes(update.status ?? "")
          )
            await emit({
              type: "tool_result",
              id: update.toolCallId,
              name: update.title ?? "OpenCode",
              text: JSON.stringify(update.rawOutput ?? update.content ?? ""),
              failed: update.status === "failed",
            });
        },
      }),
      ndJsonStream(
        Writable.toWeb(process.input),
        Readable.toWeb(process.output) as ReadableStream<Uint8Array>,
      ),
    );
    await process.launch({
      command: "opencode",
      args: ["acp"],
      instructions,
      env: {
        ...env,
        XDG_DATA_HOME: `${ready.home}/opencode/data`,
        XDG_CONFIG_HOME: `${ready.home}/opencode/config`,
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          instructions: [`${ready.cwd}/.domos-instructions.md`],
        }),
      },
    });
    const hello = await rpc.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: { name: "domos", version: "1.0.0" },
    });
    const params = {
      cwd: ready.cwd,
      mcpServers: [
        { type: "http" as const, name: "domos", url: ready.url, headers: [] },
      ],
    };
    if (sessionId && !hello.agentCapabilities?.loadSession)
      throw new Error("OpenCode 当前版本无法恢复这个会话。请开始新会话。");
    const result = sessionId
      ? await rpc.loadSession({ ...params, sessionId })
      : await rpc.newSession(params);
    const id = sessionId ?? (result as { sessionId: string }).sessionId;
    const modelOption = result.configOptions?.find(
      (item) => item.category === "model",
    );
    if (config.model && modelOption)
      await rpc.setSessionConfigOption({
        sessionId: id,
        configId: modelOption.id,
        value: config.model,
      });
    await emit({ type: "session", id });
    return {
      id,
      models: async () =>
        modelOption?.type === "select"
          ? modelOption.options.flatMap((item) =>
              "value" in item
                ? [{ id: item.value, name: item.name }]
                : item.options.map((option) => ({
                    id: option.value,
                    name: option.name,
                  })),
            )
          : [],
      authenticated: async () =>
        Boolean(env?.OPENAI_API_KEY || ready.accounts?.opencode),
      async prompt(text) {
        active = true;
        messageId = `opencode:${++sequence}`;
        await emit({ type: "accepted" });
        try {
          const outcome = await rpc.prompt({
            sessionId: id,
            prompt: [{ type: "text", text }],
          });
          if (outcome.stopReason === "cancelled")
            throw new Error("工作已停止。");
        } finally {
          active = false;
        }
      },
      interrupt: () => rpc.cancel({ sessionId: id }),
      async answer(requestId, answer) {
        const item = pending.get(requestId);
        if (!item) throw new Error("这次确认已经失效。");
        item.answer(answer);
      },
    };
  },
};
