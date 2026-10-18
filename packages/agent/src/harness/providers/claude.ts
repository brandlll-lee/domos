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
  capabilities: { approvals: true, models: false, recovery: false },
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
    rpc.on("frame", (frame: ClaudeFrame) => {
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
              type: "text",
              id: message.id,
              text: textContent(message.content),
              replace: true,
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
    rpc.on("closed", (error) => completion?.reject(error));
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
      async prompt(text) {
        completion = Promise.withResolvers<void>();
        void completion.promise.catch(() => {});
        await rpc.send({
          type: "user",
          message: { role: "user", content: text },
        });
        await emit({ type: "accepted" });
        await completion.promise;
        await events;
      },
      interrupt: () => process.close(),
      answer: async () => {
        throw new Error("请回复当前确认卡片。");
      },
    };
  },
};
