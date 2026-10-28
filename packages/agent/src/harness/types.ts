import type { Readable, Writable } from "node:stream";
import type { Attachment } from "../attachments.ts";
import type { InputMaterials } from "../materials.ts";
import type { ChatMessage } from "../messages.ts";

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
  configuredModel?: string | null;
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
export type EngineImage = { type: "image"; data: string; mimeType: string };
export type EngineApproval = {
  takeover?: NonNullable<ChatMessage["takeover"]>;
  preview?: EngineImage;
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
export type ProductTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: import("@modelcontextprotocol/sdk/types.js").ToolAnnotations;
};
export type ProductResult =
  import("@modelcontextprotocol/sdk/types.js").CallToolResult;
export type ProcessSpec = {
  command: string;
  args: string[];
  env?: Record<string, string>;
  instructions?: string;
  mcp?: { url: string };
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
  close(): Promise<void>;
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
  shutdownMs: 5_000,
  approvalMs: 10 * 60_000,
  frameBytes: 16 * 1024 * 1024,
  historyEntries: 64,
  historyCharacters: 16_000,
} as const;
