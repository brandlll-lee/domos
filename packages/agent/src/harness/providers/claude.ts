import { randomUUID } from "node:crypto";
import { JsonLines } from "../json-lines.ts";
import type { EngineOpen, EngineProvider } from "../types.ts";
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
  response?: { request_id: string; subtype: string; error?: string };
  is_error?: boolean;
  message?: { id: string; content?: ClaudePart[] };
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
  capabilities: { approvals: true, models: false, recovery: true },
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
    let interruption:
      | { id: string; result: ReturnType<typeof Promise.withResolvers<void>> }
      | undefined;
    rpc.on("frame", (frame: ClaudeFrame) => {
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
            if (frame.is_error)
              completion?.reject(
                new Error("Claude Code 未完成任务。请检查账号和网络。"),
              );
            else completion?.resolve();
          }
        })
        .catch((error) => completion?.reject(error));
    });
    rpc.on("closed", (error) => {
      completion?.reject(error);
      interruption?.result.reject(error);
    });
    await process.launch({
      command: "claude",
      args: [
        "--print",
        "--verbose",
        "--include-partial-messages",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        sessionId ? "--resume" : "--session-id",
        id,
        "--append-system-prompt-file",
        "__DOMOS_PROMPT__",
        "--mcp-config",
        "__DOMOS_MCP__",
        "--strict-mcp-config",
        "--permission-prompt-tool",
        "mcp__domos__approve",
        ...(config.model ? ["--model", config.model] : []),
      ],
      instructions,
      mcp: { url: ready.url },
      env: { ...env, CLAUDE_CONFIG_DIR: `${ready.home}/claude` },
    });
    await emit({ type: "session", id });
    return {
      id,
      models: async () => [],
      vision: async () => null,
      async prompt(text, images = []) {
        completion = Promise.withResolvers<void>();
        void completion.promise.catch(() => {});
        const uuid = randomUUID();
        await emit({ type: "accepted", id: `claude:${uuid}` });
        await rpc.send({
          type: "user",
          uuid,
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
        await completion.promise;
        await events;
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
      async recover(cursor) {
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
          turn
            .slice(1)
            .some(
              (entry) =>
                entry.type === "user" &&
                (!Array.isArray(entry.message.content) ||
                  entry.message.content.some(
                    (part) => part.type !== "tool_result",
                  )),
            )
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
  },
};
