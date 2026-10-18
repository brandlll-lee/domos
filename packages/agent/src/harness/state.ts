import type { JsonRepresentation } from "@earendil-works/chord";
import { defineDoc, type TaskId } from "@earendil-works/pi-durable";
import type { ChatMessage } from "../messages.ts";
import type { EngineApproval, EngineConfig } from "./types.ts";

export const EngineMessage = "domos.engine-message";

export type EngineState = {
  config: EngineConfig;
  revision: number;
  requestId: string;
  sessionId: string | null;
  computerId: string | null;
  taskId: TaskId | null;
  tasks: TaskId[];
  activeId: TaskId | null;
  activeTurn: string | null;
  turnId: string | null;
  dispatch: "ready" | "sending" | "accepted";
  drafts: JsonRepresentation<ChatMessage>[];
  approvals: EngineApproval[];
  error: string | null;
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
    approvals: [],
    error: null,
    prepared: false,
    prompt: null,
  }),
});
