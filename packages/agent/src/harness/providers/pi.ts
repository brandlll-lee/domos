import type {
  AgentSessionEvent,
  RpcExtensionUIRequest,
  RpcSessionState,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { thinkingControl } from "../../models.ts";
import { EngineRequestRejected, JsonLines } from "../json-lines.ts";
import type { EngineOpen, EngineProvider } from "../types.ts";
import { piUI } from "./pi-ui.ts";

export const piProvider: EngineProvider = {
  id: "pi",
  name: "Pi",
  command: "pi",
  package: "@earendil-works/pi-coding-agent@1.2.0",
  login: null,
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
    const rpc = new JsonLines(process, true);
    const preparation = Promise.withResolvers<void>();
    void preparation.promise.catch(() => {});
    let messageId = "";
    let sequence = 0;
    let failure: string | null = null;
    let compactionError: string | null = null;
    let completion: ReturnType<typeof Promise.withResolvers<void>> | undefined;
    let events = Promise.resolve();
    const ui = piUI(rpc, emit);
    const readContext = async () => {
      const stats = await rpc
        .request<{
          contextUsage?: { tokens: number | null; contextWindow: number };
        }>("get_session_stats")
        .catch(() => null);
      await emit({
        type: "context",
        tokens: stats?.contextUsage?.tokens ?? null,
        window:
          stats?.contextUsage?.contextWindow ??
          state.model?.contextWindow ??
          null,
        source: "pi.get_session_stats",
        basis: "window",
        estimated: true,
        model: state.model
          ? `${state.model.provider}/${state.model.id}`
          : config.model,
      });
    };
    rpc.on(
      "frame",
      (
        frame:
          | AgentSessionEvent
          | { type: "domos_ready"; error?: string }
          | RpcExtensionUIRequest,
      ) => {
        if (frame.type === "domos_ready") {
          if (frame.error) preparation.reject(new Error(frame.error));
          else preparation.resolve();
          return;
        }
        events = events
          .then(async () => {
            if (frame.type === "extension_ui_request") {
              await ui.handle(frame);
              return;
            }
            if (
              frame.type === "message_start" &&
              frame.message?.role === "assistant"
            ) {
              messageId = `pi:${++sequence}`;
              await emit({ type: "runtime", state: { processing: true } });
            }
            if (frame.type === "message_update") {
              const part = frame.assistantMessageEvent;
              if (
                part?.type === "text_delta" ||
                part?.type === "thinking_delta"
              )
                await emit({
                  type: part.type === "text_delta" ? "text" : "thinking",
                  id: messageId,
                  text: part.delta,
                });
            }
            if (
              frame.type === "message_end" &&
              frame.message?.role === "assistant"
            ) {
              const message = frame.message;
              if (message.usage)
                await emit({
                  type: "usage",
                  usage: {
                    id: `pi:${message.timestamp}`,
                    source: "pi.message_end",
                    provider: message.provider,
                    model: message.model,
                    input: message.usage.input ?? null,
                    output: message.usage.output ?? null,
                    cacheRead: message.usage.cacheRead ?? null,
                    cacheWrite: message.usage.cacheWrite ?? null,
                    costUsd: message.usage.cost?.total ?? null,
                  },
                });
              if (message.stopReason === "stop") failure = null;
              else if (message.stopReason === "error")
                failure =
                  message.errorMessage ?? "Pi 未完成回复。请检查账号和网络。";
              else if (message.stopReason === "aborted")
                failure = "工作已停止。";
              if (
                message.stopReason !== "error" &&
                message.stopReason !== "aborted"
              )
                await emit({
                  type: "message",
                  id: messageId,
                  text: textContent(message.content),
                });
            }
            if (frame.type === "tool_execution_start")
              await emit({
                type: "tool",
                id: frame.toolCallId,
                name: frame.toolName,
                input: frame.args ?? {},
              });
            if (frame.type === "tool_execution_end")
              await emit({
                type: "tool_result",
                id: frame.toolCallId,
                name: frame.toolName,
                text: textContent(frame.result?.content),
                failed: Boolean(frame.isError),
              });
            if (frame.type === "agent_settled") {
              if (failure) completion?.reject(new Error(failure));
              else completion?.resolve();
            }
            if (frame.type === "compaction_start")
              await emit({
                type: "compaction",
                status: "running",
                trigger: frame.reason === "manual" ? "manual" : "auto",
              });
            if (frame.type === "compaction_end") {
              compactionError =
                frame.aborted || frame.errorMessage
                  ? (frame.errorMessage ?? "压缩已取消。")
                  : null;
              await emit({
                type: "compaction",
                status:
                  frame.aborted || frame.errorMessage ? "failed" : "completed",
                ...(frame.errorMessage ? { error: frame.errorMessage } : {}),
              });
            }
          })
          .catch((error) => completion?.reject(error));
      },
    );
    rpc.on("closed", (error) => {
      preparation.reject(error);
      completion?.reject(error);
    });
    await process.launch({
      command: "pi",
      accountSource: config.accountSource,
      args: [
        "--session-dir",
        `${ready.home}/pi/sessions`,
        "--append-system-prompt",
        "__DOMOS_PROMPT__",
        ...(config.accountSource === "native"
          ? [
              "--no-extensions",
              "--extension",
              "builtin:mcp",
              "--extension",
              "builtin:codemode",
              "--extension",
              "builtin:tool-search",
              "--no-skills",
              "--no-prompt-templates",
              "--no-context-files",
            ]
          : []),
      ],
      instructions,
      env: {
        ...env,
        ...(config.accountSource === "native"
          ? {}
          : { PI_CODING_AGENT_DIR: `${ready.home}/pi` }),
        DOMOS_PI_MCP_URL: ready.url,
      },
    });
    await preparation.promise;
    const selected = sessionId
      ? await rpc.request<{ cancelled?: boolean }>("switch_session", {
          sessionPath: sessionId,
        })
      : await rpc.request<{ cancelled?: boolean }>("new_session");
    if (selected.cancelled) throw new Error("Pi 会话切换已取消。");
    await rpc.request("set_steering_mode", { mode: "all" });
    if (config.model) {
      const separator = config.model.indexOf("/");
      if (separator < 1) throw new Error("请选择 Pi 的模型。");
      await rpc.request("set_model", {
        provider: config.model.slice(0, separator),
        modelId: config.model.slice(separator + 1),
      });
    }
    const state = await rpc.request<RpcSessionState>("get_state");
    if (!state.sessionFile) throw new Error("Pi 没有返回会话记录。");
    const sessionFile = state.sessionFile;
    await emit({ type: "session", id: sessionFile });
    await readContext();
    const checkpoint = async () => {
      if (!process.checkpoint)
        throw new Error("工作电脑尚未提供 Pi 会话书签。");
      return process.checkpoint("pi", sessionFile);
    };
    const historySince = async (since: string) => {
      if (!process.history) throw new Error("工作电脑尚未提供 Pi 历史读取。");
      const entries = (await process.history(
        sessionFile,
        "pi",
        since,
      )) as SessionEntry[];
      return { entries, leafId: entries.at(-1)?.id ?? (since || null) };
    };
    if (config.options?.thinkingLevel)
      await rpc.request("set_thinking_level", {
        level: config.options.thinkingLevel,
      });
    if (config.options?.autoCompaction)
      await rpc.request("set_auto_compaction", {
        enabled: config.options.autoCompaction === "on",
      });
    if (config.options?.steeringMode)
      await rpc.request("set_steering_mode", {
        mode: config.options.steeringMode,
      });
    const autoCompaction = config.options?.autoCompaction
      ? config.options.autoCompaction === "on"
      : state.autoCompactionEnabled;
    await emit({
      type: "runtime",
      state: {
        contextPolicy: {
          manual: true,
          automatic:
            autoCompaction === undefined
              ? "native"
              : autoCompaction
                ? "enabled"
                : "disabled",
          refresh: true,
        },
      },
    });
    return {
      id: state.sessionFile,
      async controls() {
        const state = await rpc.request<RpcSessionState>("get_state");
        const levels = await rpc.request<{ levels?: string[] }>(
          "get_available_thinking_levels",
        );
        const commands = await rpc.request<{
          commands?: { name: string; description?: string }[];
        }>("get_commands");
        return {
          compact: true,
          commands: (commands.commands ?? []).map((item) => ({
            name: item.name,
            description: item.description ?? "",
          })),
          options: [
            {
              id: "thinkingLevel",
              kind: "effort",
              label: "推理强度",
              value: state.thinkingLevel ?? "",
              options: (levels.levels ?? []).map((id) => ({ id, label: id })),
            },
            {
              id: "autoCompaction",
              label: "自动压缩",
              value: state.autoCompactionEnabled ? "on" : "off",
              options: [
                { id: "on", label: "开启" },
                { id: "off", label: "关闭" },
              ],
            },
            {
              id: "steeringMode",
              label: "追加消息",
              value: state.steeringMode ?? "all",
              options: [
                { id: "all", label: "全部" },
                { id: "one-at-a-time", label: "逐条" },
              ],
            },
          ],
        };
      },
      async compact() {
        compactionError = null;
        const before = await checkpoint();
        await emit({
          type: "accepted",
          id: `pi:${before ?? ""}`,
          ready: false,
        });
        await rpc.request("compact", {}, 0);
        await events;
        if (compactionError) throw new Error(compactionError);
        await emit({ type: "compaction", status: "completed" });
        await readContext();
      },
      async recoverCompaction(cursor) {
        if (!cursor?.startsWith("pi:")) return false;
        const since = cursor.slice(3);
        const history = await historySince(since);
        const entries = new Map(
          history.entries.map((entry) => [entry.id, entry]),
        );
        let id = history.leafId;
        const visited = new Set<string>();
        let compacted = false;
        while (id && id !== since) {
          if (visited.has(id)) return false;
          visited.add(id);
          const entry = entries.get(id);
          if (!entry) return false;
          compacted ||= entry.type === "compaction";
          id = entry.parentId;
        }
        if ((id ?? "") !== since || !compacted) return false;
        await emit({ type: "compaction", status: "completed" });
        await readContext();
        return true;
      },
      models: async () => {
        const result = await rpc.request<{
          models: Parameters<typeof thinkingControl>[0][];
        }>("get_available_models");
        return (result.models ?? []).map((model) => ({
          id: `${model.provider}/${model.id}`,
          name: model.name ?? model.id,
          effort: thinkingControl(model),
          ...(model.input ? { images: model.input.includes("image") } : {}),
        }));
      },
      authenticated: async () =>
        Boolean(
          (await rpc.request<{ models: unknown[] }>("get_available_models"))
            .models?.length,
        ),
      vision: async () =>
        state.model?.input ? state.model.input.includes("image") : null,
      async prompt(text, images = []) {
        if (
          images.length &&
          state.model?.input &&
          !state.model.input.includes("image")
        )
          throw new Error("当前模型不支持图片。请选择支持图片的模型。");
        completion = Promise.withResolvers<void>();
        failure = null;
        void completion.promise.catch(() => {});
        const cursor = `pi:${(await checkpoint()) ?? ""}`;
        await emit({ type: "accepted", id: cursor, ready: false });
        const result = await rpc.request("prompt", {
          message: text,
          ...(images.length ? { images } : {}),
        });
        await emit({ type: "accepted", id: cursor });
        if (result.disposition === "handled") completion.resolve();
        await completion.promise;
        await events;
        await readContext();
      },
      async interrupt() {
        await ui.interrupt();
        await rpc.request("clear_queue");
        await rpc.request("abort");
      },
      async steer(text, images = []) {
        if (
          images.length &&
          state.model?.input &&
          !state.model.input.includes("image")
        )
          return "refused";
        try {
          await rpc.request("steer", {
            message: text,
            ...(images.length ? { images } : {}),
          });
          return "accepted";
        } catch (error) {
          return error instanceof EngineRequestRejected
            ? "refused"
            : "uncertain";
        }
      },
      async recover(cursor, inputCount = 1) {
        if (!cursor?.startsWith("pi:")) return false;
        const since = cursor.slice(3);
        const history = await historySince(since);
        const entries = new Map(
          history.entries.map((entry) => [entry.id, entry]),
        );
        const branch: SessionEntry[] = [];
        let id = history.leafId;
        while (id && id !== since) {
          const entry = entries.get(id);
          if (!entry || branch.some((item) => item.id === id)) return false;
          branch.unshift(entry);
          id = entry.parentId;
        }
        if ((id ?? "") !== since) return false;
        const messages = branch
          .filter((entry) => entry.type === "message")
          .map((entry) => entry.message);
        const final = messages.at(-1);
        if (
          messages.filter((message) => message.role === "user").length !==
            inputCount ||
          final?.role !== "assistant" ||
          final.stopReason !== "stop"
        )
          return false;
        let index = 0;
        for (const message of messages) {
          if (message.role === "assistant") {
            await emit({
              type: "message",
              id: `pi:${++index}`,
              text: textContent(message.content),
            });
            for (const part of message.content)
              if (part.type === "toolCall")
                await emit({
                  type: "tool",
                  id: part.id,
                  name: part.name,
                  input: part.arguments,
                });
          } else if (message.role === "toolResult")
            await emit({
              type: "tool_result",
              id: message.toolCallId,
              name: message.toolName,
              text: textContent(message.content),
              failed: message.isError,
            });
        }
        return true;
      },
      answer: ui.answer,
    };
  },
};

export function textContent(content: unknown): string {
  return typeof content === "string"
    ? content
    : (Array.isArray(content) ? content : [])
        .filter(
          (part) => part?.type === "text" && typeof part.text === "string",
        )
        .map((part: { text: string }) => part.text)
        .join("\n");
}
