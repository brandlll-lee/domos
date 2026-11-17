import type { ToolCall, ToolCallUpdate } from "@agentclientprotocol/sdk";
import { z } from "zod";
import { openCodeRequest } from "../http-service.mjs";
import { mcpCatalog, mcpEntries } from "../mcp-catalog.ts";
import type { EngineOpen } from "../types.ts";

export async function readOpenCodeMcp(
  process: EngineOpen["process"],
  scope: "configuration" | "session",
  signal?: AbortSignal,
) {
  const result = z
    .record(z.string(), z.unknown())
    .parse(await process.request(...openCodeRequest("mcp"), undefined, signal));
  const parsed = mcpEntries(
    z.object({
      name: z.string().min(1),
      status: z.string(),
      error: z.string().optional(),
    }),
    Object.entries(result).map(([name, value]) =>
      typeof value === "object" && value ? { ...value, name } : { name },
    ),
  );
  return mcpCatalog(
    parsed.items.map((item) => ({
      name: item.name,
      source: "opencode",
      enabled:
        item.status === "disabled"
          ? false
          : [
                "connected",
                "failed",
                "needs_auth",
                "needs_client_registration",
              ].includes(item.status)
            ? true
            : null,
      status: item.status,
      error: item.error,
    })),
    scope,
    parsed.errors,
  );
}

type NativeMessage = {
  info: {
    id: string;
    role: string;
    parentID?: string;
    finish?: string;
    summary?: boolean;
    error?: unknown;
    time?: { created?: number; completed?: number };
    modelID?: string;
    providerID?: string;
    cost?: number;
    tokens?: {
      input?: number;
      output?: number;
      cache?: { read?: number; write?: number };
    };
  };
  parts: {
    id?: string;
    type: string;
    text?: string;
    callID?: string;
    tool?: string;
    state?: {
      status: string;
      input?: Record<string, unknown>;
      output?: string;
      error?: string;
      title?: string;
      time?: { start?: number; end?: number };
      metadata?: Record<string, unknown>;
    };
  }[];
};

export function completedCompaction(messages: NativeMessage[]) {
  return messages.findLast(
    (message) =>
      message.info.role === "assistant" &&
      message.info.summary &&
      message.info.finish &&
      !message.info.error &&
      messages.some(
        (parent) =>
          parent.info.id === message.info.parentID &&
          parent.info.role === "user" &&
          parent.parts.some((part) => part.type === "compaction"),
      ),
  );
}

export function openCodeRecords(
  process: EngineOpen["process"],
  id: string,
  emit: EngineOpen["emit"],
  recordTool: (
    update: ToolCall | ToolCallUpdate,
    recovered?: boolean,
    timing?: { timestamp?: number; endedAt?: number; receivedAt?: number },
  ) => Promise<void>,
) {
  const messages = () =>
    process.request<NativeMessage[]>(...openCodeRequest("messages", id));
  const since = (history: NativeMessage[], baseline: string) => {
    if (baseline.startsWith("time:")) {
      const time = Number(baseline.slice(5));
      if (
        !Number.isFinite(time) ||
        history.some((message) => !message.info.time?.created)
      )
        return null;
      if (
        history.length === 256 &&
        (history[0]?.info.time?.created ?? 0) >= time
      )
        return null;
      return history.filter(
        (message) => (message.info.time?.created ?? 0) >= time,
      );
    }
    const start = history.findIndex((message) => message.info.id === baseline);
    return baseline && start < 0 ? null : history.slice(start + 1);
  };
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
  const recordMessage = async (message: NativeMessage, recovered = false) => {
    await record(message);
    const metadata = recovered
      ? {
          recovered: true,
          timestamp: message.info.time?.created,
          endedAt: message.info.time?.completed,
        }
      : {};
    for (const [index, part] of message.parts.entries()) {
      if (part.type === "reasoning" && part.text)
        await emit({
          type: "thinking",
          id: part.id ?? `${message.info.id}:${index}`,
          text: part.text,
          replace: true,
          ...metadata,
        });
      if (part.type === "tool" && part.callID && part.state)
        await recordTool(
          {
            toolCallId: part.callID,
            title: part.state.title ?? part.tool ?? "Tool",
            rawInput: part.state.input,
            rawOutput: part.state.output ?? part.state.error,
            status:
              part.state.status === "error"
                ? "failed"
                : (part.state.status as ToolCall["status"]),
          },
          recovered,
          {
            timestamp: part.state.time?.start,
            endedAt: part.state.time?.end,
          },
        );
    }
    await emit({
      type: "message",
      id: message.info.id,
      text: message.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join("\n"),
      ...metadata,
    });
  };

  return { messages, since, record, recordMessage };
}
