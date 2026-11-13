import type { ConversationFile } from "@domos/agent/files";

export type MessageTarget = Pick<ConversationFile, "messageId" | "cursor"> &
  Partial<Pick<ConversationFile, "file">> & { sessionId?: number };
