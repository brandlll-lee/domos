import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ProductTool } from "../harness/types.ts";
import type { McpConfig } from "../mcp/connections.ts";

export type OperationInput = {
  action: string;
  id?: string;
  config?: McpConfig;
  method?: string;
  params?: Record<string, unknown>;
  oauth?: Record<string, unknown>;
  redirectUrl?: string;
  authorizationCode?: string;
  state?: string;
};
export type OperationResult = {
  tools?: ProductTool[];
  capabilities?: Record<string, unknown>;
  oauth: Record<string, unknown>;
  authorizationUrl?: string;
  result?: unknown;
};
export function mcpOperation(
  input: OperationInput,
  signal?: AbortSignal,
  onprogress?: (progress: Record<string, unknown>) => void,
  onnotification?: (notification: Record<string, unknown>) => void,
): Promise<OperationResult>;
export function openMcpClient(
  input: OperationInput,
  signal?: AbortSignal,
): Promise<{
  client?: Client;
  authorizationUrl?: string;
  oauth: Record<string, unknown>;
  close?: () => Promise<void>;
}>;
export function closeMcpClients(): Promise<void>;
