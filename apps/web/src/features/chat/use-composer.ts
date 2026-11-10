import type { Attachment } from "@domos/agent/attachments";
import type { InputMaterials } from "@domos/agent/materials";
import { useRef } from "react";
import { chatCopy } from "./copy.ts";
import type { SendInput } from "./use-chat.ts";
import type { useDraft } from "./use-draft.ts";

export type SendMessage = (
  input: SendInput,
  attachments?: Attachment[],
  materials?: InputMaterials,
) => Promise<"accepted" | "rejected" | "unconfirmed">;

export function useComposer(
  draft: ReturnType<typeof useDraft>,
  canSubmit: boolean,
  send: SendMessage,
) {
  const submitting = useRef(false);
  const caret = useRef(0);
  const pending = draft.draft.pending;
  async function submit() {
    if (!canSubmit || submitting.current) return;
    const original = draft.current.current;
    const text = original.text.trim();
    const leading = original.text.length - original.text.trimStart().length;
    const position = (value: number | undefined) =>
      value === undefined ? undefined : Math.max(0, value - leading);
    const input = pending ?? {
      text,
      attachments: draft.current.current.attachments.map((file) => file.id),
      skills: original.materials.skills.map(
        ({ id, revision, native, position: at }) => ({
          id,
          revision,
          ...(native ? { native } : {}),
          ...(position(at) === undefined ? {} : { position: position(at) }),
        }),
      ),
      mcp: original.materials.mcp?.map(
        ({ id, native, available, status, position: at }) => ({
          id,
          native,
          ...(native ? { available, status } : {}),
          position: position(at),
        }),
      ),
      context: original.materials.context.map((item) => {
        const at = position(item.position);
        return item.type === "message"
          ? {
              id: item.id,
              type: item.type,
              messageId: item.messageId,
              ...(at === undefined ? {} : { position: at }),
            }
          : {
              id: item.id,
              type: item.type,
              text: item.text,
              ...(at === undefined ? {} : { position: at }),
            };
      }),
      requestId: crypto.randomUUID(),
    };
    if (
      !input.text &&
      !input.attachments?.length &&
      !input.skills?.length &&
      !input.context?.length &&
      !input.mcp?.length
    )
      return;
    if (!draft.update({ pending: input, text: pending ? original.text : "" })) {
      draft.update(original);
      return;
    }
    submitting.current = true;
    try {
      const result = await send(input, draft.current.current.attachments, {
        mcp: original.materials.mcp?.map((item) => ({
          ...item,
          position: input.mcp?.find((selected) => selected.id === item.id)
            ?.position,
        })),
        skills: original.materials.skills.map((item) => ({
          ...item,
          position: input.skills?.find((skill) => skill.id === item.id)
            ?.position,
        })),
        context: original.materials.context.map((item) => ({
          ...item,
          position: input.context?.find((context) => context.id === item.id)
            ?.position,
        })),
      });
      if (result !== "unconfirmed") {
        draft.update({
          pending: null,
          ...(result === "accepted"
            ? {
                materials: {
                  mcp: draft.current.current.materials.mcp?.filter(
                    (item) =>
                      !input.mcp?.some((selected) => selected.id === item.id),
                  ),
                  skills: draft.current.current.materials.skills.filter(
                    (skill) =>
                      !input.skills?.some((item) => item.id === skill.id),
                  ),
                  context: draft.current.current.materials.context.filter(
                    (context) =>
                      !input.context?.some((item) => item.id === context.id),
                  ),
                },
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
    materials: {
      mcp: draft.draft.materials.mcp?.filter(
        (item) => !pending?.mcp?.some((selected) => selected.id === item.id),
      ),
      skills: draft.draft.materials.skills.filter(
        (skill) => !pending?.skills?.some((item) => item.id === skill.id),
      ),
      context: draft.draft.materials.context.filter(
        (context) => !pending?.context?.some((item) => item.id === context.id),
      ),
    },
    setMaterials: (materials: InputMaterials) => draft.update({ materials }),
    attachments: draft.draft.attachments.filter(
      (file) => !pending?.attachments?.includes(file.id),
    ),
    remove: (id: string) =>
      draft.update({
        attachments: draft.current.current.attachments.filter(
          (file) => file.id !== id,
        ),
      }),
    caret,
    moveCaret: (position: number) => {
      caret.current = position;
    },
    change: (
      text: string,
      position: number,
      positions: { id: string; position: number }[],
    ) => {
      caret.current = position;
      const byId = new Map(positions.map((item) => [item.id, item.position]));
      draft.update({
        text,
        materials: {
          mcp: draft.current.current.materials.mcp
            ?.filter(
              (item) =>
                byId.has(`mcp:${item.id}`) ||
                pending?.mcp?.some((selected) => selected.id === item.id),
            )
            .map((item) =>
              byId.has(`mcp:${item.id}`)
                ? { ...item, position: byId.get(`mcp:${item.id}`) }
                : item,
            ),
          skills: draft.current.current.materials.skills
            .filter(
              (item) =>
                byId.has(`skill:${item.id}`) ||
                pending?.skills?.some((skill) => skill.id === item.id),
            )
            .map((item) =>
              byId.has(`skill:${item.id}`)
                ? { ...item, position: byId.get(`skill:${item.id}`) }
                : item,
            ),
          context: draft.current.current.materials.context
            .filter(
              (item) =>
                byId.has(`context:${item.id}`) ||
                pending?.context?.some((context) => context.id === item.id),
            )
            .map((item) =>
              byId.has(`context:${item.id}`)
                ? { ...item, position: byId.get(`context:${item.id}`) }
                : item,
            ),
        },
      });
    },
    submit,
    pending: pending !== null,
    error:
      draft.error ??
      (pending && !submitting.current && canSubmit
        ? chatCopy.errors.unconfirmed
        : null),
  };
}
