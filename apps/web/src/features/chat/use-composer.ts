import { useRef } from "react";
import { chatCopy } from "./copy.ts";
import type { SendInput } from "./use-chat.ts";
import { useDraft } from "./use-draft.ts";

export type SendMessage = (
  input: SendInput,
) => Promise<"accepted" | "rejected" | "unconfirmed">;

export function useComposer(
  conversationId: number,
  canSubmit: boolean,
  send: SendMessage,
) {
  const draft = useDraft(conversationId);
  const submitting = useRef(false);
  const pending = draft.draft.pending;
  async function submit() {
    if (!canSubmit || submitting.current) return;
    const input = pending ?? {
      text: draft.current.current.text.trim(),
      requestId: crypto.randomUUID(),
    };
    if (!input.text || !draft.update({ pending: input })) return;
    submitting.current = true;
    try {
      const result = await send(input);
      if (result !== "unconfirmed") {
        draft.update({
          pending: null,
          ...(result === "accepted" &&
          draft.current.current.text.trim() === input.text
            ? { text: "" }
            : {}),
        });
      }
    } finally {
      submitting.current = false;
    }
  }
  return {
    value: draft.draft.text,
    change: (text: string) => draft.update({ text }),
    submit,
    pending: pending !== null,
    error:
      draft.error ??
      (pending && !submitting.current ? chatCopy.errors.unconfirmed : null),
  };
}
