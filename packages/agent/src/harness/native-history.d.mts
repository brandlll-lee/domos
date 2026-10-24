import type { EngineId } from "./types.ts";
export function historyProjection(value: unknown): unknown;
export function nativeCheckpoint(
  input: { provider: EngineId; sessionId: string },
  home: string,
): Promise<string | null>;
export function nativeHistory(
  input: { provider: EngineId; sessionId: string; since?: string },
  home: string,
): Promise<Record<string, unknown>[]>;
