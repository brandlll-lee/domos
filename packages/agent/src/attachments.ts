export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;
export type Attachment = {
  id: string;
  name: string;
  size: number;
  path: string;
  mimeType?: string;
};
