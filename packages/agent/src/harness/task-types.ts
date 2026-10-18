import type { JsonRepresentation } from "@earendil-works/chord";
import type {
  SubmissionId,
  TaskId,
  TaskRuntime,
} from "@earendil-works/pi-durable";
import type { Attachment } from "../attachments.ts";
import type { ChatMessage } from "../messages.ts";

export type EngineTaskInput = {
  text: string;
  submissionId: SubmissionId;
  previous: TaskId | null;
  turnId: string;
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
): StoredMessage {
  return stored({
    id,
    turnId: id,
    role: "user",
    content: [{ type: "text", text, key: id }],
    stopped: false,
    ...(attachments?.length ? { attachments } : {}),
  } satisfies ChatMessage);
}
