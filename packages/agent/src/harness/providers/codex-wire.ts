import type { z } from "zod";

export type CodexItem = {
  id: string;
  type: string;
  tool?: string;
  arguments?: Record<string, unknown>;
  command?: string;
  changes?: unknown;
  text?: string;
  aggregatedOutput?: string;
  result?: unknown;
  status?: string;
  error?: unknown;
  [field: string]: unknown;
};
export type CodexTurn = {
  id: string;
  status: string;
  items?: CodexItem[];
};
export type CodexFrame = {
  id?: string | number;
  method: string;
  params?: {
    plan?: import("../types.ts").EnginePlan;
    threadId?: string;
    turnId?: string;
    requestId?: string | number;
    tokenUsage?: {
      total?: {
        inputTokens?: number;
        outputTokens?: number;
        cachedInputTokens?: number;
      };
      last?: { inputTokens?: number };
      modelContextWindow?: number;
    };
    itemId?: string;
    delta?: string;
    item?: CodexItem;
    turn?: CodexTurn;
    questions?: {
      id: string;
      question: string;
      options?: { label: string; description?: string }[];
      isOther?: boolean;
    }[];
    permissions?: Record<string, unknown>;
    command?: string;
    cwd?: string;
    reason?: string;
    serverName?: string;
    mode?: string;
    message?: string;
    url?: string;
    requestedSchema?: z.core.JSONSchema.JSONSchema;
    _meta?: { codex_approval_kind?: string; persist?: string[] };
  };
};
export const codexApprovals = new Set([
  "mcpServer/elicitation/request",
  "item/tool/requestUserInput",
  "item/permissions/requestApproval",
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
]);

export function codexItemEvents(
  item: CodexItem,
  completed: boolean,
  recovered = false,
): import("../types.ts").EngineEvent[] {
  const metadata = { native: item, ...(recovered ? { recovered: true } : {}) };
  if (item.type === "agentMessage")
    return completed
      ? [{ type: "message", id: item.id, text: item.text ?? "", ...metadata }]
      : [];
  if (item.type === "reasoning")
    return completed
      ? [
          {
            type: "thinking",
            id: item.id,
            text: [
              ...(Array.isArray(item.summary) ? item.summary : []),
              ...(Array.isArray(item.content) ? item.content : []),
            ].join("\n"),
            replace: true,
            ...metadata,
          },
        ]
      : [];
  if (
    ![
      "commandExecution",
      "fileChange",
      "mcpToolCall",
      "dynamicToolCall",
      "collabAgentToolCall",
      "collabToolCall",
      "webSearch",
      "imageView",
      "imageGeneration",
    ].includes(item.type)
  )
    return [];
  const name = item.tool ?? item.type;
  const {
    aggregatedOutput: _output,
    result: _result,
    error: _error,
    ...inputNative
  } = item;
  const events: import("../types.ts").EngineEvent[] = [];
  events.push({
    type: "tool",
    id: item.id,
    name,
    input: item.arguments ?? {
      ...(item.command ? { command: item.command } : {}),
      ...(item.changes ? { changes: item.changes } : {}),
      ...(item.query ? { query: item.query } : {}),
      ...(item.path ? { path: item.path } : {}),
    },
    ...metadata,
    native: inputNative,
  });
  if (completed)
    events.push({
      type: "tool_result",
      id: item.id,
      name,
      text:
        item.aggregatedOutput ??
        (item.error as { message?: string } | null)?.message ??
        (
          (
            item.result as {
              content?: { type: string; text?: string }[];
            } | null
          )?.content ?? []
        )
          .filter((part) => part.type === "text")
          .map((part) => part.text ?? "")
          .join("\n"),
      failed:
        ["failed", "declined", "interrupted", "cancelled"].includes(
          item.status ?? "",
        ) ||
        Boolean(item.error) ||
        item.success === false ||
        (item.result as { isError?: boolean } | null)?.isError === true,
      ...metadata,
    });
  return events;
}
