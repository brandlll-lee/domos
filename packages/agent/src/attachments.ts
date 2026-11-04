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
  directory?: string;
  source?: EvidenceSource;
  display?: "inline";
};

export type FilePreviewKind =
  | "image"
  | "pdf"
  | "markdown"
  | "text"
  | "csv"
  | "html"
  | "download";

const textTypes: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  html: "text/html",
  htm: "text/html",
  txt: "text/plain",
  log: "text/plain",
  json: "application/json",
  jsonl: "text/plain",
  xml: "text/plain",
  js: "text/plain",
  jsx: "text/plain",
  ts: "text/plain",
  tsx: "text/plain",
  py: "text/plain",
  css: "text/plain",
  yaml: "text/plain",
  yml: "text/plain",
  sh: "text/plain",
  sql: "text/plain",
  rs: "text/plain",
  go: "text/plain",
  java: "text/plain",
  c: "text/plain",
  cpp: "text/plain",
  h: "text/plain",
};

export function textFileType(name: string, bytes: Uint8Array) {
  const mime = textTypes[name.split(".").at(-1)?.toLowerCase() ?? ""];
  if (!mime) return undefined;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    for (const character of text) {
      const code = character.charCodeAt(0);
      if (code < 9 || (code > 13 && code < 32)) return undefined;
    }
    return mime;
  } catch {
    return undefined;
  }
}

export function filePreviewKind(
  file: Pick<Attachment, "mimeType" | "name">,
): FilePreviewKind {
  const mime = file.mimeType?.split(";")[0];
  if (mime?.startsWith("image/") && mime !== "image/svg+xml") return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/html") return "html";
  if (mime === "text/markdown") return "markdown";
  if (mime === "text/csv") return "csv";
  if (mime?.startsWith("text/") || mime === "application/json") return "text";
  return "download";
}
