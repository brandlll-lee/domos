import type { Readable, Writable } from "node:stream";
import type { Attachment } from "../attachments.ts";

export const engineIds = ["pi", "codex", "claude", "opencode"] as const;
export type EngineId = (typeof engineIds)[number];
export type EngineConfig = { provider: EngineId; model: string | null };
export type EngineModel = { id: string; name: string };
export type EngineApproval = {
  id: string;
  title: string;
  detail: string;
  kind: "permission" | "question";
};
export type EngineAnswer = { allow: boolean; text?: string };
export type EngineEvent =
  | { type: "session"; id: string }
  | { type: "accepted"; id?: string }
  | { type: "text" | "thinking"; id: string; text: string; replace?: boolean }
  | { type: "message"; id: string; text: string }
  | { type: "tool"; id: string; name: string; input: Record<string, unknown> }
  | {
      type: "tool_result";
      id: string;
      name: string;
      text: string;
      failed: boolean;
    }
  | { type: "approval"; approval: EngineApproval };

export type ProductTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};
export type ProductResult =
  import("@modelcontextprotocol/sdk/types.js").CallToolResult;
export type ProcessSpec = {
  command: string;
  args: string[];
  env?: Record<string, string>;
  instructions?: string;
  mcp?: { url: string };
  http?: { timeoutMs: number; readyMs: number };
};
export type ProcessReady = {
  url: string;
  cwd: string;
  home: string;
};
export interface EngineProcess {
  readonly input: Writable;
  readonly output: Readable;
  readonly error: Readable;
  readonly ready: Promise<ProcessReady>;
  readonly closed: Promise<{ code: number | null; error?: string }>;
  launch(spec: ProcessSpec): Promise<void>;
  request<T = unknown>(
    path: string,
    method?: string,
    body?: unknown,
  ): Promise<T>;
  close(): Promise<void>;
}

export interface EngineSession {
  readonly id: string;
  models(): Promise<EngineModel[]>;
  authenticated?(): Promise<boolean>;
  prompt(text: string): Promise<void>;
  interrupt(): Promise<void>;
  answer(id: string, answer: EngineAnswer): Promise<void>;
  recover?(turnId: string | null): Promise<boolean>;
}

export type EngineOpen = {
  process: EngineProcess;
  config: EngineConfig;
  sessionId: string | null;
  instructions: string;
  env?: Record<string, string>;
  emit: (event: EngineEvent) => Promise<void>;
};
export interface EngineProvider {
  readonly id: EngineId;
  readonly name: string;
  readonly command: string;
  readonly package: string;
  readonly login: readonly string[] | null;
  readonly capabilities: {
    approvals: boolean;
    models: boolean;
    recovery: boolean;
  };
  open(input: EngineOpen): Promise<EngineSession>;
}

export type EngineInput = {
  text: string;
  requestId: string;
  attachments?: Attachment[];
  whenBusy?: "reject" | "followUp";
};

export const engineLimits = {
  handshakeMs: 30_000,
  shutdownMs: 5_000,
  approvalMs: 10 * 60_000,
  frameBytes: 16 * 1024 * 1024,
  outputCharacters: 32_000,
  flushMs: 80,
  historyEntries: 64,
  historyCharacters: 16_000,
} as const;
