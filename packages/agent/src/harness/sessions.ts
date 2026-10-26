import { createHash } from "node:crypto";
import type { EngineState } from "./state.ts";
import type { EngineConfig } from "./types.ts";

export function sessionKey(
  computerId: string | null,
  config: EngineConfig,
  account: string,
) {
  return JSON.stringify([
    computerId,
    config.provider,
    config.accountSource ?? "managed",
    createHash("sha256").update(account).digest("hex"),
  ]);
}

export function selectSession(doc: EngineState, key: string) {
  doc.sessions ??= {};
  if (doc.sessionKey === key) {
    doc.sessionId ??= doc.sessions[key]?.id ?? null;
    return;
  }
  const previous = doc.sessionKey;
  if (previous && doc.sessionId)
    doc.sessions[previous] ??= { id: doc.sessionId, through: null };
  if (previous) doc.sessionId = doc.sessions[key]?.id ?? null;
  doc.sessionKey = key;
}

export function switchSession(
  doc: EngineState,
  config: EngineConfig,
  computerId: string | null,
) {
  const compatible =
    doc.computerId === computerId &&
    doc.config.provider === config.provider &&
    (doc.config.accountSource ?? "managed") ===
      (config.accountSource ?? "managed");
  if (compatible) return;
  if (doc.sessionId) {
    doc.sessions ??= {};
    const key = doc.sessionKey ?? sessionKey(doc.computerId, doc.config, "");
    doc.sessions[key] ??= { id: doc.sessionId, through: null };
  }
  doc.sessionId = null;
  doc.computerId = computerId;
}
