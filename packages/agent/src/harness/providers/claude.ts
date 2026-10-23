import { randomUUID } from "node:crypto";
import { JsonLines } from "../json-lines.ts";
import {
  type EngineControls,
  type EngineImage,
  type EngineOpen,
  type EngineProvider,
  engineLimits,
} from "../types.ts";
import { textContent } from "./pi.ts";

type ClaudePart = {
  type: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  thinking?: string;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
};
type ClaudeFrame = {
  type: string;
  subtype?: string;
  status?: string;
  model?: string;
  permissionMode?: string;
  mcp_servers?: { name: string; status: string }[];
  skills?: string[];
  compact_result?: string;
  compact_metadata?: { trigger?: string; pre_tokens?: number };
  parent_tool_use_id?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  modelUsage?: Record<string, { contextWindow?: number }>;
  total_cost_usd?: number;
  uuid?: string;
  isReplay?: boolean;
  queued_turn_count?: number;
  origin?: { kind: string };
  response?: {
    request_id: string;
    subtype: string;
    error?: string;
    response?: {
      models?: {
        value: string;
        displayName?: string;
        supportedEffortLevels?: string[];
      }[];
      commands?: { name: string; description: string }[];
    };
  };
  is_error?: boolean;
  message?: {
    id: string;
    model?: string;
    content?: ClaudePart[];
    usage?: ClaudeFrame["usage"];
  };
  event?: {
    type: string;
    message?: { id: string };
    delta?: { type: string; text?: string; thinking?: string };
  };
};

export const claudeProvider: EngineProvider = {
  id: "claude",
  name: "Claude Code",
  command: "claude",
  package: "@anthropic-ai/claude-code@2.1.284",
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
    const id = sessionId ?? randomUUID();
    const rpc = new JsonLines(process);
    let completion: ReturnType<typeof Promise.withResolvers<void>> | undefined;
    let events = Promise.resolve();
    let messageId = "";
    let running = false;
    let compacting = false;
    let contextTokens: number | null = null;
    let contextWindow: number | null = null;
    const readContext = () =>
      emit({
        type: "context",
        tokens: contextTokens,
        window: contextWindow,
        source: "claude.assistant.usage",
        basis: "last-input",
        estimated: false,
        model: nativeModel,
      });
    let compactBoundary = false;
    let nativeModel = config.model;
    const controls = new Map<
      string,
      {
        resolve: (
          value: NonNullable<ClaudeFrame["response"]>["response"],
        ) => void;
        reject: (error: Error) => void;
        timer: NodeJS.Timeout;
      }
    >();
    const inputs = new Map<
      string,
      {
        resolve: (result: "accepted" | "uncertain") => void;
        timer: NodeJS.Timeout;
      }
    >();
    function releaseInputs() {
      for (const input of inputs.values()) {
        clearTimeout(input.timer);
        input.resolve("uncertain");
      }
      inputs.clear();
    }
    function sendInput(text: string, images: EngineImage[], uuid: string) {
      return rpc.send({
        type: "user",
        uuid,
        origin: { kind: "human" },
        message: {
          role: "user",
          content: images.length
            ? [
                { type: "text", text },
                ...images.map((image) => ({
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: image.mimeType,
                    data: image.data,
                  },
                })),
              ]
            : text,
        },
      });
    }
    let interruption:
      | { id: string; result: ReturnType<typeof Promise.withResolvers<void>> }
      | undefined;
    rpc.on("frame", (frame: ClaudeFrame) => {
      if (frame.type === "control_response" && frame.response) {
        const pending = controls.get(frame.response.request_id);
        if (pending) {
          clearTimeout(pending.timer);
          controls.delete(frame.response.request_id);
          if (frame.response.subtype === "error")
            pending.reject(
              new Error(frame.response.error ?? "引擎拒绝了配置请求。"),
            );
          else pending.resolve(frame.response.response);
          return;
        }
      }
      if (
        frame.type === "control_response" &&
        frame.response?.request_id === interruption?.id
      ) {
        if (frame.response?.subtype === "error")
          interruption?.result.reject(
            new Error(frame.response.error ?? "中断未确认。"),
          );
        else interruption?.result.resolve();
        return;
      }
      events = events
        .then(async () => {
          if (frame.parent_tool_use_id) return;
          if (frame.type === "system" && frame.subtype === "init") {
            nativeModel = frame.model ?? nativeModel;
            await emit({
              type: "runtime",
              state: {
                integrations: frame.mcp_servers ?? [],
                skills: frame.skills ?? [],
              },
            });
          }
          if (frame.type === "system" && frame.status === "compacting")
            await emit({ type: "compaction", status: "running" });
          if (frame.type === "system" && frame.subtype === "compact_boundary") {
            compactBoundary = true;
            contextTokens = null;
            await emit({
              type: "compaction",
              status: "completed",
              ...(frame.uuid ? { nativeId: frame.uuid } : {}),
              ...(frame.compact_metadata?.trigger === "auto" ||
              frame.compact_metadata?.trigger === "manual"
                ? { trigger: frame.compact_metadata.trigger }
                : {}),
              beforeTokens: frame.compact_metadata?.pre_tokens,
            });
            await readContext();
          }
          if (frame.compact_result === "failed")
            await emit({ type: "compaction", status: "failed" });
          if (frame.type === "stream_event") {
            if (frame.event?.message) messageId = frame.event.message.id;
            const delta = frame.event?.delta;
            if (messageId && (delta?.text || delta?.thinking))
              await emit({
                type: delta.text ? "text" : "thinking",
                id: messageId,
                text: delta.text ?? delta.thinking ?? "",
              });
          }
          if (frame.type === "assistant" && frame.message) {
            const message = frame.message;
            if (message.model && message.model !== nativeModel) {
              nativeModel = message.model;
              contextWindow = null;
            }
            if (message.usage?.input_tokens !== undefined) {
              contextTokens =
                message.usage.input_tokens +
                (message.usage.cache_read_input_tokens ?? 0) +
                (message.usage.cache_creation_input_tokens ?? 0);
              await readContext();
            }
            await emit({
              type: "message",
              id: message.id,
              text: textContent(message.content),
            });
            for (const part of message.content ?? []) {
              if (part.type === "thinking" && part.thinking)
                await emit({
                  type: "thinking",
                  id: message.id,
                  text: part.thinking,
                  replace: true,
                });
              if (part.type === "tool_use" && part.id && part.name)
                await emit({
                  type: "tool",
                  id: part.id,
                  name: part.name,
                  input: part.input ?? {},
                });
            }
          }
          if (frame.type === "user") {
            if (frame.isReplay && frame.uuid) {
              const input = inputs.get(frame.uuid);
              if (input) {
                clearTimeout(input.timer);
                inputs.delete(frame.uuid);
                input.resolve("accepted");
              }
              return;
            }
            for (const part of frame.message?.content ?? [])
              if (part.type === "tool_result" && part.tool_use_id)
                await emit({
                  type: "tool_result",
                  id: part.tool_use_id,
                  name: "Claude Code",
                  text: textContent(part.content),
                  failed: Boolean(part.is_error),
                });
          }
          if (frame.type === "result") {
            if (frame.origin?.kind === "task-notification") return;
            if (frame.usage && frame.uuid) {
              const models = Object.keys(frame.modelUsage ?? {});
              const model =
                models.length > 1 ? null : (models[0] ?? nativeModel);
              await emit({
                type: "usage",
                usage: {
                  id: `claude:${frame.uuid}`,
                  source: "claude.result",
                  provider: null,
                  model: model ?? null,
                  input: frame.usage.input_tokens ?? null,
                  output: frame.usage.output_tokens ?? null,
                  cacheRead: frame.usage.cache_read_input_tokens ?? null,
                  cacheWrite: frame.usage.cache_creation_input_tokens ?? null,
                  costUsd: frame.total_cost_usd ?? null,
                  costScope: "session",
                },
              });
              contextWindow =
                frame.modelUsage?.[nativeModel ?? ""]?.contextWindow ?? null;
              await readContext();
            }
            if (
              !frame.is_error &&
              (inputs.size || (frame.queued_turn_count ?? 0) > 0)
            )
              return;
            running = false;
            releaseInputs();
            if (frame.is_error || (compacting && !compactBoundary))
              completion?.reject(
                new Error("Claude Code 未完成任务。请检查账号和网络。"),
              );
            else completion?.resolve();
          }
        })
        .catch((error) => completion?.reject(error));
    });
    rpc.on("closed", (error) => {
      running = false;
      releaseInputs();
      completion?.reject(error);
      interruption?.result.reject(error);
      for (const pending of controls.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      controls.clear();
    });
    await process.launch({
      command: "claude",
      accountSource: config.accountSource,
      args: [
        "--print",
        "--verbose",
        "--include-partial-messages",
        "--replay-user-messages",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        sessionId ? "--resume" : "--session-id",
        id,
        "--append-system-prompt-file",
        "__DOMOS_PROMPT__",
        "--append-subagent-system-prompt-file",
        "__DOMOS_PROMPT__",
        "--mcp-config",
        "__DOMOS_MCP__",
        "--strict-mcp-config",
        ...(config.accountSource === "native"
          ? ["--setting-sources", "project"]
          : []),
        "--permission-prompt-tool",
        "mcp__domos__approve",
        ...(config.model ? ["--model", config.model] : []),
        ...(config.options?.effort ? ["--effort", config.options.effort] : []),
        ...(config.options?.permissionMode
          ? ["--permission-mode", config.options.permissionMode]
          : []),
      ],
      instructions,
      mcp: { url: ready.url },
      env: {
        ...env,
        ...(config.accountSource === "native"
          ? {}
          : { CLAUDE_CONFIG_DIR: `${ready.home}/claude` }),
      },
    });
    await emit({ type: "session", id });
    await emit({
      type: "runtime",
      state: {
        contextPolicy: { manual: true, automatic: "native", refresh: false },
      },
    });
    let initialization:
      | Promise<NonNullable<ClaudeFrame["response"]>["response"]>
      | undefined;
    function initialize() {
      initialization ??= (async () => {
        const requestId = randomUUID();
        const result =
          Promise.withResolvers<
            NonNullable<ClaudeFrame["response"]>["response"]
          >();
        const timer = setTimeout(() => {
          controls.delete(requestId);
          result.reject(new Error("引擎没有返回配置目录。"));
        }, engineLimits.handshakeMs);
        timer.unref();
        controls.set(requestId, { ...result, timer });
        await rpc.send({
          type: "control_request",
          request_id: requestId,
          request: { subtype: "initialize" },
        });
        return result.promise;
      })();
      return initialization;
    }
    const session = {
      id,
      async controls(): Promise<EngineControls> {
        const catalog = await initialize();
        const model = catalog?.models?.find(
          (item) => item.value === nativeModel,
        );
        return {
          compact: true,
          commands: catalog?.commands ?? [],
          options: [
            {
              id: "effort",
              kind: "effort",
              label: "推理强度",
              value: config.options?.effort ?? "",
              options: (model?.supportedEffortLevels ?? []).map((id) => ({
                id,
                label: id,
              })),
            },
            {
              id: "permissionMode",
              label: "工作模式",
              value: config.options?.permissionMode ?? "default",
              options: [
                { id: "default", label: "默认确认" },
                { id: "plan", label: "计划" },
                { id: "acceptEdits", label: "允许文件编辑" },
              ],
            },
          ],
        };
      },
      async compact() {
        compacting = true;
        compactBoundary = false;
        try {
          await session.prompt("/compact");
        } finally {
          compacting = false;
        }
      },
      models: async () =>
        ((await initialize())?.models ?? []).map((item) => ({
          id: item.value,
          name: item.displayName ?? item.value,
          effort: {
            id: "effort",
            kind: "effort" as const,
            label: "推理强度",
            value: "",
            options: (item.supportedEffortLevels ?? []).map((id) => ({
              id,
              label: id,
            })),
          },
        })),
      vision: async () => null,
      async prompt(text: string, images: EngineImage[] = []) {
        completion = Promise.withResolvers<void>();
        void completion.promise.catch(() => {});
        const uuid = randomUUID();
        running = true;
        await emit({ type: "accepted", id: `claude:${uuid}`, ready: false });
        await sendInput(text, images, uuid);
        await emit({ type: "accepted", id: `claude:${uuid}` });
        await completion.promise;
        await events;
      },
      async steer(
        text: string,
        images: EngineImage[] = [],
      ): Promise<"accepted" | "refused" | "uncertain"> {
        if (!running) return "refused";
        const uuid = randomUUID();
        const receipt = Promise.withResolvers<"accepted" | "uncertain">();
        const timer = setTimeout(() => {
          inputs.delete(uuid);
          receipt.resolve("uncertain");
          completion?.reject(
            new Error("追加消息的接收结果未确认。请核对回复后再发送。"),
          );
        }, engineLimits.handshakeMs);
        timer.unref();
        inputs.set(uuid, { resolve: receipt.resolve, timer });
        try {
          await sendInput(text, images, uuid);
          return await receipt.promise;
        } catch {
          clearTimeout(timer);
          inputs.delete(uuid);
          return "uncertain";
        }
      },
      async interrupt() {
        interruption ??= {
          id: randomUUID(),
          result: Promise.withResolvers<void>(),
        };
        void interruption.result.promise.catch(() => {});
        await rpc.send({
          type: "control_request",
          request_id: interruption.id,
          request: { subtype: "interrupt" },
        });
        await interruption.result.promise;
      },
      async recover(cursor: string | null, inputCount = 1) {
        if (!cursor?.startsWith("claude:") || !process.history) return false;
        const history = (await process.history(id)) as {
          type: string;
          uuid: string;
          parent_tool_use_id?: string | null;
          message: { id?: string; content?: unknown; stop_reason?: string };
        }[];
        const messages = history.filter(
          (message) => !message.parent_tool_use_id,
        );
        const start = messages.findIndex(
          (message) =>
            message.type === "user" && message.uuid === cursor.slice(7),
        );
        if (start < 0) return false;
        const turn = messages.slice(start);
        const final = turn.at(-1);
        if (
          final?.type !== "assistant" ||
          final.message.stop_reason !== "end_turn"
        )
          return false;
        if (
          turn.filter(
            (entry) =>
              entry.type === "user" &&
              (!Array.isArray(entry.message.content) ||
                entry.message.content.some(
                  (part) => part.type !== "tool_result",
                )),
          ).length !== inputCount
        )
          return false;
        for (const entry of turn) {
          if (entry.type === "assistant" && entry.message.id)
            await emit({
              type: "message",
              id: entry.message.id,
              text: textContent(entry.message.content),
            });
        }
        return true;
      },
      answer: async () => {
        throw new Error("请回复当前确认卡片。");
      },
    };
    return session;
  },
};
