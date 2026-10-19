import type { ProductResult, ProductTool } from "./types.ts";

export function openGateway(
  tools: ProductTool[],
  invoke: (
    callId: string,
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<ProductResult>,
): Promise<{ url: string; close(): Promise<void> }>;
