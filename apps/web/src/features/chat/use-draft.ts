import { useRef, useState } from "react";
import type { SendInput } from "./use-chat.ts";

type Draft = { text: string; pending: SendInput | null };
const empty: Draft = { text: "", pending: null };
const storageError = "草稿保存失败。请允许浏览器存储后重试。";

function load(key: string): { draft: Draft; error: string | null } {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { draft: empty, error: null };
    const value = JSON.parse(raw);
    if (
      typeof value.text !== "string" ||
      (value.pending !== null &&
        (typeof value.pending?.text !== "string" ||
          typeof value.pending?.requestId !== "string"))
    )
      throw new Error("Invalid draft");
    return { draft: value, error: null };
  } catch {
    return { draft: empty, error: storageError };
  }
}

export function useDraft(conversationId: number) {
  const key = `domos:composer:v1:${conversationId}`;
  const [state, setState] = useState(() => load(key));
  const current = useRef(state.draft);
  function update(patch: Partial<Draft>) {
    const draft = { ...current.current, ...patch };
    current.current = draft;
    try {
      localStorage.setItem(key, JSON.stringify(draft));
      setState({ draft, error: null });
      return true;
    } catch {
      setState({ draft, error: storageError });
      return false;
    }
  }
  return { ...state, current, update };
}
