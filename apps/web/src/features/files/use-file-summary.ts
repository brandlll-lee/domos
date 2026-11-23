import { type Attachment, filePreviewKind } from "@domos/agent/attachments";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { fileSummary } from "./file-state.ts";

export function useFileSummary(botId: number, file: Attachment) {
  const store = fileSummary(botId, file);
  const { data: summary, error } = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
  );
  const element = useRef<HTMLDivElement>(null);
  const kind = filePreviewKind(file);
  useEffect(() => {
    if (!element.current || !["image", "pdf", "audio", "video"].includes(kind))
      return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        void store.load().catch(() => {});
      }
    });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [kind, store]);
  return { element, summary, error };
}
