import { randomUUID } from "node:crypto";
import { defineDoc, type Tx } from "@earendil-works/pi-durable";
import type { EngineState } from "./state.ts";
import type { EngineRuntime } from "./task-types.ts";
import type {
  EngineCompaction,
  EngineEvent,
  EngineRuntimeState,
} from "./types.ts";

type CompactionRecord = EngineCompaction & {
  status: NonNullable<EngineRuntimeState["compaction"]>;
};
const CompactionTaskDoc = defineDoc<{
  items: Record<string, CompactionRecord>;
}>({
  kind: "domos.engine-compaction",
  version: 1,
  scope: "task",
  initial: () => ({ items: {} }),
});

export async function projectContext(
  tx: Tx,
  doc: EngineState,
  runtime: EngineRuntime,
  event: Extract<EngineEvent, { type: "context" | "compaction" }>,
) {
  doc.runtime ??= {};
  const state = doc.runtime;
  if (event.type === "context") {
    if (
      (event.tokens !== null &&
        (!Number.isFinite(event.tokens) || event.tokens < 0)) ||
      (event.window !== null &&
        (!Number.isFinite(event.window) || event.window <= 0))
    )
      return;
    state.contextTokens = event.tokens;
    state.contextWindow = event.window;
    state.context = {
      source: event.source,
      basis: event.basis,
      estimated: event.estimated,
      observedAt: Date.now(),
      harness: doc.config.provider,
      sessionId: doc.sessionId,
      model: event.model ?? doc.config.model,
    };
    if (
      event.basis === "window" &&
      state.compaction === "completed" &&
      state.compactionDetails?.taskId === String(runtime.taskId) &&
      state.compactionDetails.afterTokens === null
    )
      state.compactionDetails.afterTokens = event.tokens;
  } else {
    if (
      (event.status === "running" && state.compaction !== "running") ||
      state.compactionDetails?.taskId !== String(runtime.taskId) ||
      (event.nativeId &&
        state.compactionDetails?.nativeId &&
        event.nativeId !== state.compactionDetails.nativeId)
    ) {
      state.compactionDetails = {
        id: randomUUID(),
        taskId: String(runtime.taskId),
        sessionId: doc.sessionId,
        model: state.context?.model ?? doc.config.model,
        trigger: event.trigger ?? "native",
        startedAt: event.status === "running" ? Date.now() : null,
        endedAt: null,
        beforeTokens: event.beforeTokens ?? state.contextTokens ?? null,
        afterTokens: null,
        error: null,
      };
      state.contextTokens = null;
      delete state.context;
    }
    if (state.compactionDetails) {
      if (event.nativeId) state.compactionDetails.nativeId = event.nativeId;
      if (event.trigger) state.compactionDetails.trigger = event.trigger;
      if (event.beforeTokens !== undefined)
        state.compactionDetails.beforeTokens = event.beforeTokens;
      if (event.status !== "running")
        state.compactionDetails.endedAt = Date.now();
      state.compactionDetails.error = event.error ?? null;
    }
    state.compaction = event.status;
  }
  const details = state.compactionDetails;
  if (details?.taskId === String(runtime.taskId) && state.compaction)
    (await tx.doc(CompactionTaskDoc, runtime.taskId)).items[details.id] = {
      ...details,
      status: state.compaction,
    };
}

export async function finishCompactions(tx: Tx, runtime: EngineRuntime) {
  const doc = await tx.doc(CompactionTaskDoc, runtime.taskId);
  for (const record of Object.values(doc.items))
    await tx.appendEntry(runtime.conversationId, {
      kind: "domos.engine-compaction",
      data: record,
    });
  doc.items = {};
}
