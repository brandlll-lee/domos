import type { Attachment } from "@domos/agent/attachments";
import { useRef, useState } from "react";
import { chatCopy } from "./copy.ts";
import type { SendInput } from "./use-chat.ts";

type Draft = {
  text: string;
  attachments: Attachment[];
  pending: SendInput | null;
};
const empty: Draft = { text: "", attachments: [], pending: null };
const storageError = chatCopy.errors.draft;

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
    const attachments = value.attachments ?? [];
    if (
      !Array.isArray(attachments) ||
      attachments.some(
        (file) =>
          typeof file.id !== "string" ||
          typeof file.name !== "string" ||
          typeof file.size !== "number" ||
          typeof file.path !== "string",
      )
    )
      throw new Error("Invalid attachments");
    return { draft: { ...value, attachments }, error: null };
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
