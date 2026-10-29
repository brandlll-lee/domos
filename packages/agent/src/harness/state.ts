import type { JsonRepresentation } from "@earendil-works/chord";
import {
  defineDoc,
  type EntryId,
  type TaskId,
} from "@earendil-works/pi-durable";
import type { ChatMessage } from "../messages.ts";
import type { EngineConfig, EngineRuntimeState } from "./types.ts";

export const EngineMessage = "domos.engine-message";

export const EngineInputDoc = defineDoc<{
  status:
    | "queued"
    | "deferred"
    | "sending"
    | "accepted"
    | "uncertain"
    | "settled";
  owner: TaskId | null;
}>({
  kind: "domos.engine-input",
  version: 1,
  checkpointWhen: () => false,
  scope: "task",
  initial: () => ({ status: "queued", owner: null }),
});

export type EngineState = {
  config: EngineConfig;
  revision: number;
  requestId: string;
  sessionId: string | null;
  sessions?: Record<string, { id: string; through: EntryId | null }>;
  sessionKey?: string;
  computerId: string | null;
  taskId: TaskId | null;
  tasks: TaskId[];
  activeId: TaskId | null;
  activeTurn: string | null;
  turnId: string | null;
  dispatch: "ready" | "sending" | "accepted";
  drafts: JsonRepresentation<ChatMessage>[];
  error: string | null;
  runtime?: EngineRuntimeState;
  run?: import("./types.ts").EngineRun;
  prepared: boolean;
  preparedComputerId?: string | null;
  prompt: {
    text: string;
    sections: Record<string, string>;
    tools: string[];
  } | null;
};
export const EngineDoc = defineDoc<EngineState>({
  kind: "domos.engine",
  version: 1,
  checkpointWhen: () => false,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({
    config: { provider: "pi", model: null },
    revision: 0,
    requestId: "",
    sessionId: null,
    computerId: null,
    taskId: null,
    tasks: [],
    activeId: null,
    activeTurn: null,
    turnId: null,
    dispatch: "ready",
    drafts: [],
    error: null,
    prepared: false,
    prompt: null,
  }),
});
