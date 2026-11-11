import type { Attachment } from "@domos/agent/attachments";
import { useEffect } from "react";
import { useReadState } from "../read-state.ts";
import { userError } from "../user-error.ts";
import { fileState, previewState } from "./file-state.ts";

export function useDocumentPreview(
  botId: number,
  file: Attachment,
  sheet?: string,
) {
  const store = previewState(botId, file.id, sheet);
  useEffect(() => store.retain(), [store]);
  const state = useReadState(store.read);
  return { ...state, retry: () => void store.read.load(true).catch(() => {}) };
}

export function useFile(botId: number, file: Attachment, active = true) {
  const store = fileState(botId, file.id);
  const state = useReadState(store, active);
  return {
    blob: state.data,
    error: state.error
      ? userError(state.error, "文件读取失败，请重试。")
      : undefined,
    retry: () => {
      void store.load(true).catch(() => {});
    },
  };
}

export function downloadFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
