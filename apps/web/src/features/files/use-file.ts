import type { Attachment } from "@domos/agent/attachments";
import { useEffect, useState } from "react";
import { client } from "../../client.ts";

export function useFile(botId: number, file: Attachment) {
  const [state, setState] = useState<{ blob?: Blob; error?: string }>({});
  const [retry, setRetry] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry starts a fresh request.
  useEffect(() => {
    const controller = new AbortController();
    setState({});
    void client.files
      .download({ botId, id: file.id }, { signal: controller.signal })
      .then((blob) => {
        if (!controller.signal.aborted) setState({ blob });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setState({ error: "文件读取失败，请重试。" });
      });
    return () => controller.abort();
  }, [botId, file.id, retry]);
  return { ...state, retry: () => setRetry((value) => value + 1) };
}

export function downloadFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
