import type { Readable, Writable } from "node:stream";
import type { Attachment } from "../attachments.ts";
import type { InputMaterials } from "../materials.ts";

export const engineIds = ["pi", "codex", "claude", "opencode"] as const;
export type EngineId = (typeof engineIds)[number];
export type EngineConfig = {
  provider: EngineId;
  model: string | null;
  accountSource?: "managed" | "native";
  options?: Record<string, string>;
};
export type EngineControls = {
  options: {
    id: string;
    label: string;
    value: string;
    kind?: "effort";
    defaultValue?: string;
    options: { id: string; label: string }[];
  }[];
  commands: { name: string; description: string }[];
  compact: boolean;
};
export type EngineContextReading = {
  source: string;
  basis: "window" | "last-input";
  estimated: boolean;
  observedAt: number;
  harness: EngineId;
  sessionId: string | null;
  model: string | null;
};
export type EngineCompaction = {
  id: string;
  harness: EngineId;
  nativeId?: string;
  taskId: string;
  sessionId: string | null;
  model: string | null;
  trigger: "manual" | "auto" | "native";
  startedAt: number | null;
  endedAt: number | null;
  beforeTokens: number | null;
  afterTokens: number | null;
  error: string | null;
};
export type EngineUsage = {
  id: string;
  source: string;
  provider: string | null;
  model: string | null;
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  costUsd: number | null;
  costScope?: "session";
};
export type EngineRuntimeState = {
  processing?: boolean;
  retry?: string | null;
  compaction?: "running" | "completed" | "failed" | "uncertain";
  compactionDetails?: EngineCompaction;
  contextTokens?: number | null;
  contextWindow?: number | null;
  context?: EngineContextReading;
  contextPolicy?: {
    manual: boolean;
    automatic: "native" | "enabled" | "disabled";
    refresh: boolean;
  };
  controls?: EngineControls;
  notices?: Record<string, string>;
  integrations?: { name: string; status: string }[];
  skills?: string[];
  editorText?: string;
};
export type EngineModel = {
  id: string;
  name: string;
  images?: boolean;
  group?: string;
  effort?: EngineControls["options"][number];
};
export type EngineImage = { type: "image"; data: string; mimeType: string };
export type EngineApproval = {
  id: string;
  title: string;
  detail: string;
  kind: "permission" | "question";
  automatic?: boolean;
  url?: string;
  questions?: {
    id: string;
    title: string;
    options?: { id: string; label: string; description?: string }[];
    multiple?: boolean;
    allowOther?: boolean;
    value?: string | string[];
    multiline?: boolean;
    required?: boolean;
  }[];
  options?: { id: string; label: string }[];
};
export type EngineAnswer = {
  allow: boolean;
  text?: string;
  answers?: Record<string, string[]>;
  optionId?: string;
};
export type EngineEvent =
  | {
      type: "context";
      tokens: number | null;
      window: number | null;
      source: string;
      basis: EngineContextReading["basis"];
      estimated: boolean;
      model?: string | null;
    }
  | {
      type: "compaction";
      status: NonNullable<EngineRuntimeState["compaction"]>;
      trigger?: EngineCompaction["trigger"];
      beforeTokens?: number;
      error?: string;
      nativeId?: string;
    }
  | { type: "approval_closed"; id: string }
  | { type: "usage"; usage: EngineUsage }
  | { type: "runtime"; state: EngineRuntimeState }
  | { type: "session"; id: string }
  | { type: "accepted"; id?: string; ready?: boolean }
  | { type: "text" | "thinking"; id: string; text: string; replace?: boolean }
  | { type: "message"; id: string; text: string }
  | { type: "tool"; id: string; name: string; input: Record<string, unknown> }
  | {
      type: "tool_result";
      id: string;
      name: string;
      text: string;
      failed: boolean;
      attachments?: Attachment[];
    }
  | { type: "approval"; approval: EngineApproval };

export type ProductTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: import("@modelcontextprotocol/sdk/types.js").ToolAnnotations;
};
export type ProductResult =
  import("@modelcontextprotocol/sdk/types.js").CallToolResult;
export type ProcessSpec = {
  command: string;
  args: string[];
  accountSource?: EngineConfig["accountSource"];
  env?: Record<string, string>;
  instructions?: string;
  mcp?: { url: string };
  http?: { timeoutMs: number; readyMs: number; listen?: boolean };
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
  history?(sessionId: string): Promise<unknown[]>;
  close(): Promise<void>;
}

export interface EngineSession {
  readonly id: string;
  models(): Promise<EngineModel[]>;
  controls?(): Promise<EngineControls>;
  compact?(): Promise<void>;
  authenticated?(): Promise<boolean>;
  vision?(): Promise<boolean | null>;
  prompt(text: string, images?: EngineImage[]): Promise<void>;
  steer?(
    text: string,
    images?: EngineImage[],
  ): Promise<"accepted" | "refused" | "uncertain">;
  interrupt(): Promise<void>;
  answer(id: string, answer: EngineAnswer): Promise<void>;
  recover?(turnId: string | null, inputCount?: number): Promise<boolean>;
  recoverCompaction?(cursor: string | null): Promise<boolean>;
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
  inspect?(input: Pick<EngineOpen, "process" | "config" | "env">): Promise<{
    authenticated: boolean;
    models: EngineModel[];
    controls: EngineControls;
    vision: boolean | null;
  }>;
}

export type EngineInput = {
  text: string;
  materials?: InputMaterials;
  requestId: string;
  attachments?: Attachment[];
  whenBusy?: "reject" | "followUp";
  operation?: "compact";
};

export const engineLimits = {
  handshakeMs: 30_000,
  compactionMs: 120_000,
  shutdownMs: 5_000,
  approvalMs: 10 * 60_000,
  frameBytes: 16 * 1024 * 1024,
  outputCharacters: 32_000,
  flushMs: 80,
  historyEntries: 64,
  historyCharacters: 16_000,
} as const;
