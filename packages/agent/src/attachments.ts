export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;
export type EvidenceSource = {
  tool: string;
  capturedAt: string;
  taskId: string;
  callId: string;
  url?: string;
};
export type Attachment = {
  id: string;
  name: string;
  size: number;
  path: string;
  mimeType?: string;
  computerId?: string;
  source?: EvidenceSource;
};
