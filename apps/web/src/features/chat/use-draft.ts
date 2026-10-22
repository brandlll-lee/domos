import type { Attachment } from "@domos/agent/attachments";
import type { InputMaterials } from "@domos/agent/materials";
import { useCallback, useRef, useState } from "react";
import { chatCopy } from "./copy.ts";
import type { SendInput } from "./use-chat.ts";

type Draft = {
  text: string;
  attachments: Attachment[];
  pending: SendInput | null;
  materials: InputMaterials;
};
const empty: Draft = {
  text: "",
  attachments: [],
  pending: null,
  materials: { skills: [], context: [] },
};
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
    const materials = value.materials ?? { skills: [], context: [] };
    if (
      !Array.isArray(materials.skills) ||
      !Array.isArray(materials.context) ||
      materials.skills.some(
        (item: InputMaterials["skills"][number]) =>
          typeof item.id !== "string" ||
          typeof item.revision !== "number" ||
          typeof item.name !== "string" ||
          typeof item.content !== "string",
      ) ||
      materials.context.some(
        (item: InputMaterials["context"][number]) =>
          typeof item.id !== "string" ||
          typeof item.text !== "string" ||
          !["text", "message"].includes(item.type) ||
          (item.type === "message" && typeof item.messageId !== "string"),
      )
    )
      throw new Error("Invalid materials");
    return { draft: { ...value, attachments, materials }, error: null };
  } catch {
    return { draft: empty, error: storageError };
  }
}

export function useDraft(conversationId: number) {
  const key = `domos:composer:v1:${conversationId}`;
  const [state, setState] = useState(() => load(key));
  const current = useRef(state.draft);
  const update = useCallback(
    (patch: Partial<Draft>) => {
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
    },
    [key],
  );
  return { ...state, current, update };
}
