import { ArrowUpIcon } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { StopIcon } from "@phosphor-icons/react/dist/csr/Stop";
import { useRef } from "react";
import { Button, Textarea } from "../../ui/controls.tsx";
import type { useChat } from "./use-chat.ts";
import { useDraft } from "./use-draft.ts";

export function Composer({
  chat,
  conversationId,
}: {
  chat: ReturnType<typeof useChat>;
  conversationId: number;
}) {
  const draft = useDraft(conversationId);
  const submitting = useRef(false);
  const pending = draft.draft.pending;
  async function submit() {
    if (!chat.connected || chat.view?.busy || submitting.current) return;
    const input = pending ?? {
      text: draft.current.current.text.trim(),
      requestId: crypto.randomUUID(),
    };
    if (!input.text || !draft.update({ pending: input })) return;
    submitting.current = true;
    try {
      const result = await chat.send(input);
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
  const error =
    draft.error ??
    chat.error ??
    (pending && !chat.sending ? "发送未确认。重试会核对原请求。" : null) ??
    (chat.view?.failed ? "回复失败。请检查模型配置、余额或网络。" : null);
  return (
    <footer className="composer-area">
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="sr-only" htmlFor="message">
          消息
        </label>
        <Textarea
          id="message"
          name="message"
          autoComplete="off"
          placeholder="发送消息给 Domos…"
          value={draft.draft.text}
          rows={2}
          onChange={(event) => draft.update({ text: event.target.value })}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="composer-controls">
          <span>
            <kbd>Enter</kbd> 发送 · <kbd>Shift Enter</kbd> 换行
          </span>
          {chat.view?.busy ? (
            <Button
              type="button"
              variant="secondary"
              className="send-button"
              title={chat.stopping ? "正在停止…" : "停止生成"}
              disabled={chat.stopping || !chat.connected}
              onClick={() => void chat.stop()}
            >
              <StopIcon weight="fill" />
              <span className="sr-only">
                {chat.stopping ? "正在停止…" : "停止生成"}
              </span>
            </Button>
          ) : (
            <Button
              type="submit"
              className="send-button"
              title={chat.sending ? "发送中…" : pending ? "重试发送" : "发送"}
              disabled={
                (!draft.draft.text.trim() && !pending) ||
                !chat.connected ||
                chat.sending
              }
            >
              <ArrowUpIcon />
              <span className="sr-only">
                {chat.sending ? "发送中…" : pending ? "重试发送" : "发送"}
              </span>
            </Button>
          )}
        </div>
      </form>
      <p className="composer-note">对话自动保存 · 草稿仅保存在此浏览器</p>
    </footer>
  );
}
