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
