import type { Attachment } from "@domos/agent/attachments";
import { createContext, useContext } from "react";

export const FilePreviewContext = createContext<{
  open: (file: Attachment, botId?: number) => void;
  selected?: string;
  inline: Set<string>;
  register: (id: string, active: boolean) => void;
  target: HTMLElement | null;
} | null>(null);

export function useFilePreview() {
  return useContext(FilePreviewContext);
}
