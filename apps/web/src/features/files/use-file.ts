import type { Attachment } from "@domos/agent/attachments";
import { useReadState } from "../read-state.ts";
import { userError } from "../user-error.ts";
import { fileState } from "./file-state.ts";

export function useFile(botId: number, file: Attachment) {
  const store = fileState(botId, file.id);
  const state = useReadState(store);
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
