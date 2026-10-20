import type { Attachment } from "@domos/agent/attachments";
import { useRef } from "react";
import { chatCopy } from "./copy.ts";
import type { SendInput } from "./use-chat.ts";
import type { useDraft } from "./use-draft.ts";

export type SendMessage = (
  input: SendInput,
  attachments?: Attachment[],
) => Promise<"accepted" | "rejected" | "unconfirmed">;

export function useComposer(
  draft: ReturnType<typeof useDraft>,
  canSubmit: boolean,
  send: SendMessage,
) {
  const submitting = useRef(false);
  const pending = draft.draft.pending;
  async function submit() {
    if (!canSubmit || submitting.current) return;
    const original = draft.current.current;
    const input = pending ?? {
      text: draft.current.current.text.trim(),
      attachments: draft.current.current.attachments.map((file) => file.id),
      requestId: crypto.randomUUID(),
    };
    if (!input.text && !input.attachments?.length) return;
    if (!draft.update({ pending: input, text: pending ? original.text : "" })) {
      draft.update(original);
      return;
    }
    submitting.current = true;
    try {
      const result = await send(input, draft.current.current.attachments);
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
          ...(result === "rejected" && !draft.current.current.text
            ? { text: input.text }
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
