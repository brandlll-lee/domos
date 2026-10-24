import type { JsonRepresentation } from "@earendil-works/chord";
import type {
  EntryId,
  SubmissionId,
  TaskId,
  TaskRuntime,
} from "@earendil-works/pi-durable";
import type { Attachment } from "../attachments.ts";
import type { InputMaterials } from "../materials.ts";
import type { ChatMessage } from "../messages.ts";

export type EngineTaskInput = {
  text: string;
  submissionId: SubmissionId;
  previous: TaskId | null;
  turnId: string;
  entryId?: EntryId;
  attachments?: Attachment[];
  operation?: "compact";
};
export type EngineCheckpoint = { phase: "run" };
export type EngineRuntime = TaskRuntime<
  EngineTaskInput,
  EngineCheckpoint,
  null,
  object
>;
export type StoredMessage = JsonRepresentation<ChatMessage>;
export function stored<T>(value: T): JsonRepresentation<T> {
  return JSON.parse(JSON.stringify(value));
}
export function userMessage(
  id: string,
  text: string,
  attachments?: Attachment[],
  requestId?: string,
  materials?: InputMaterials,
): StoredMessage {
  return stored({
    id,
    turnId: id,
    ...(requestId ? { requestId } : {}),
    role: "user",
    content: [{ type: "text", text, key: id }],
    stopped: false,
    timestamp: performance.timeOrigin + performance.now(),
    ...(attachments?.length ? { attachments } : {}),
    ...(materials ? { materials } : {}),
  } satisfies ChatMessage);
}
