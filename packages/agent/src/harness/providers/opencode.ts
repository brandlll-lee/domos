import { Readable, Writable } from "node:stream";
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type RequestPermissionRequest,
  type SessionConfigOption,
} from "@agentclientprotocol/sdk";
import {
  type EngineAnswer,
  type EngineControls,
  type EngineOpen,
  type EngineProvider,
  type EngineSession,
  engineLimits,
} from "../types.ts";

type NativeMessage = {
  info: {
    id: string;
    role: string;
    parentID?: string;
    finish?: string;
    error?: unknown;
    time?: { completed?: number };
    modelID?: string;
    providerID?: string;
    cost?: number;
    tokens?: {
      input?: number;
      output?: number;
      cache?: { read?: number; write?: number };
    };
  };
  parts: { type: string; text?: string }[];
};

export const opencodeProvider: EngineProvider = {
  id: "opencode",
  name: "OpenCode",
  command: "opencode",
  package: "opencode-ai@1.19.0",
  login: ["auth", "login"],
  capabilities: { approvals: true, models: true, recovery: true },
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
    let configOptions: SessionConfigOption[] = [];
    let commands: EngineControls["commands"] = [];
    let modes:
      | {
          currentModeId: string;
          availableModes: { id: string; name: string }[];
        }
      | undefined;
    const controls = (): EngineControls => ({
      compact: commands.some((item) => item.name === "compact"),
      commands,
      options: [
        ...configOptions
          .filter((item) => item.category !== "model")
          .map((item) => ({
            id: item.id,
            ...(item.category === "thought_level"
              ? { kind: "effort" as const }
              : {}),
            label: item.name,
            value: String(item.currentValue),
            options:
              item.type === "boolean"
                ? [
                    { id: "true", label: "开启" },
                    { id: "false", label: "关闭" },
                  ]
                : item.options.flatMap((option) =>
                    "value" in option
                      ? [{ id: option.value, label: option.name }]
                      : option.options.map((value) => ({
                          id: value.value,
                          label: value.name,
                        })),
                  ),
          })),
        ...(modes
          ? [
              {
                id: "mode",
                label: "工作模式",
                value: modes.currentModeId,
                options: modes.availableModes.map((item) => ({
                  id: item.id,
                  label: item.name,
                })),
              },
            ]
          : []),
      ],
    });
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
                options: request.options.map((option) => ({
                  id: option.optionId,
                  label: option.name,
                })),
              },
            });
            const answer = await result.promise;
            const option = request.options.find((item) =>
              answer.optionId
                ? item.optionId === answer.optionId
                : item.kind === (answer.allow ? "allow_once" : "reject_once"),
            );
            return {
              outcome: option
                ? { outcome: "selected", optionId: option.optionId }
                : { outcome: "cancelled" },
            };
          } finally {
            clearTimeout(timer);
            pending.delete(id);
            await emit({ type: "approval_closed", id });
          }
        },
        async sessionUpdate({ update }) {
          if (update.sessionUpdate === "usage_update")
            await emit({
              type: "runtime",
              state: { contextTokens: update.used, contextWindow: update.size },
            });
          if (update.sessionUpdate === "notice")
            await emit({
              type: "runtime",
              state: {
                notices: { [update.title]: update.description ?? update.title },
              },
            });
          if (update.sessionUpdate === "available_commands_update") {
            commands = update.availableCommands.map((item) => ({
              name: item.name,
              description: item.description,
            }));
            await emit({ type: "runtime", state: { controls: controls() } });
          }
          if (update.sessionUpdate === "config_option_update") {
            configOptions = update.configOptions;
            await emit({ type: "runtime", state: { controls: controls() } });
          }
          if (update.sessionUpdate === "current_mode_update" && modes) {
            modes.currentModeId = update.currentModeId;
            await emit({ type: "runtime", state: { controls: controls() } });
          }
          if (!active) return;
          if (
            (update.sessionUpdate === "agent_message_chunk" ||
              update.sessionUpdate === "agent_thought_chunk") &&
            update.content.type === "text"
          ) {
            if (update.messageId) messageId = update.messageId;
            await emit({
              type:
                update.sessionUpdate === "agent_message_chunk"
                  ? "text"
                  : "thinking",
              id: messageId,
              text: update.content.text,
            });
          }
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
      args: ["acp", "--hostname", "127.0.0.1", "--port", "__DOMOS_PORT__"],
      http: {
        timeoutMs: engineLimits.handshakeMs,
        readyMs: engineLimits.handshakeMs,
        listen: true,
      },
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
      clientCapabilities: {
        session: { configOptions: { boolean: {} }, notices: {} },
      },
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
    configOptions = result.configOptions ?? [];
    modes = result.modes ?? undefined;
    const modelOption = result.configOptions?.find(
      (item) => item.category === "model",
    );
    if (config.model && modelOption)
      await rpc.setSessionConfigOption({
        sessionId: id,
        configId: modelOption.id,
        value: config.model,
      });
    for (const [key, value] of Object.entries(config.options ?? {})) {
      if (key === "mode" && modes) {
        if (!modes.availableModes.some((item) => item.id === value))
          throw new Error("此引擎没有提供这个工作模式。");
        await rpc.setSessionMode({ sessionId: id, modeId: value });
        modes.currentModeId = value;
      } else {
        const option = configOptions.find((item) => item.id === key);
        if (
          !option ||
          !controls()
            .options.find((item) => item.id === key)
            ?.options.some((item) => item.id === value)
        )
          throw new Error("此引擎没有提供这个配置值。");
        const changed = await rpc.setSessionConfigOption({
          sessionId: id,
          configId: key,
          ...(option.type === "boolean"
            ? { type: "boolean", value: value === "true" }
            : { value }),
        });
        if (changed.configOptions.length) configOptions = changed.configOptions;
      }
    }
    await emit({ type: "session", id });
    const messages = () =>
      process.request<NativeMessage[]>(
        `/session/${encodeURIComponent(id)}/message`,
      );
    const record = async (message: NativeMessage) => {
      if (message.info.tokens || message.info.cost !== undefined)
        await emit({
          type: "usage",
          usage: {
            id: message.info.id,
            source: "opencode.message",
            provider: message.info.providerID ?? null,
            model: message.info.modelID ?? null,
            input: message.info.tokens?.input ?? null,
            output: message.info.tokens?.output ?? null,
            cacheRead: message.info.tokens?.cache?.read ?? null,
            cacheWrite: message.info.tokens?.cache?.write ?? null,
            costUsd: message.info.cost ?? null,
          },
        });
    };
    const session: EngineSession = {
      id,
      controls: async () => controls(),
      async compact() {
        if (!controls().compact) throw new Error("此引擎尚未提供压缩命令。");
        await emit({ type: "runtime", state: { compaction: "running" } });
        try {
          await session.prompt("/compact");
          await emit({ type: "runtime", state: { compaction: "completed" } });
        } catch (error) {
          await emit({ type: "runtime", state: { compaction: "failed" } });
          throw error;
        }
      },
      vision: async () =>
        hello.agentCapabilities?.promptCapabilities?.image ? null : false,
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
      async prompt(text, images = []) {
        if (
          images.length &&
          !hello.agentCapabilities?.promptCapabilities?.image
        )
          throw new Error("当前引擎协议不支持图片。请更换引擎或使用文本资料。");
        active = true;
        messageId = `opencode:${++sequence}`;
        const history = await messages();
        await emit({
          type: "accepted",
          id: `opencode:${history.at(-1)?.info.id ?? ""}`,
        });
        try {
          const outcome = await rpc.prompt({
            sessionId: id,
            prompt: [{ type: "text", text }, ...images],
          });
          if (outcome.stopReason === "cancelled")
            throw new Error("工作已停止。");
          for (const message of (await messages()).slice(history.length))
            if (message.info.role === "assistant") {
              await record(message);
              await emit({
                type: "message",
                id: message.info.id,
                text: message.parts
                  .filter((part) => part.type === "text")
                  .map((part) => part.text ?? "")
                  .join("\n"),
              });
            }
        } finally {
          active = false;
        }
      },
      async interrupt() {
        for (const item of pending.values()) item.answer({ allow: false });
        await rpc.cancel({ sessionId: id });
      },
      async recover(cursor) {
        if (!cursor?.startsWith("opencode:")) return false;
        const history = await messages();
        const baseline = cursor.slice(9);
        const start = baseline
          ? history.findIndex((message) => message.info.id === baseline)
          : -1;
        if (baseline && start < 0) return false;
        const turn = history.slice(start + 1);
        const users = turn.filter((message) => message.info.role === "user");
        const final = turn.at(-1)?.info;
        if (
          users.length !== 1 ||
          final?.role !== "assistant" ||
          !final.time?.completed ||
          !final.finish ||
          ["tool-calls", "unknown"].includes(final.finish) ||
          final.error ||
          final.parentID !== users[0]?.info.id
        )
          return false;
        for (const message of turn)
          if (message.info.role === "assistant") {
            await record(message);
            await emit({
              type: "message",
              id: message.info.id,
              text: message.parts
                .filter((part) => part.type === "text")
                .map((part) => part.text ?? "")
                .join("\n"),
            });
          }
        return true;
      },
      async answer(requestId, answer) {
        const item = pending.get(requestId);
        if (!item) throw new Error("这次确认已经失效。");
        item.answer(answer);
      },
    };
    return session;
  },
};
