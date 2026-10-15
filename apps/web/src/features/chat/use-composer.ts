import type { Attachment } from "@domos/agent/attachments";
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
      attachments: draft.current.current.attachments.map((file) => file.id),
      requestId: crypto.randomUUID(),
    };
    if (
      (!input.text && !input.attachments?.length) ||
      !draft.update({ pending: input })
    )
      return;
    submitting.current = true;
    try {
      const result = await send(input);
      if (result !== "unconfirmed") {
        draft.update({
          pending: null,
          ...(result === "accepted"
            ? {
                attachments: draft.current.current.attachments.filter(
                  (file) => !input.attachments?.includes(file.id),
                ),
              }
            : {}),
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
    attachments: draft.draft.attachments,
    attach: (file: Attachment) =>
      draft.update({
        attachments: [
          ...draft.current.current.attachments.filter(
            (item) => item.id !== file.id,
          ),
          file,
        ],
      }),
    remove: (id: string) =>
      draft.update({
        attachments: draft.current.current.attachments.filter(
          (file) => file.id !== id,
        ),
      }),
    change: (text: string) => draft.update({ text }),
    submit,
    pending: pending !== null,
    error:
      draft.error ??
      (pending && !submitting.current ? chatCopy.errors.unconfirmed : null),
  };
}
