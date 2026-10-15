import { useEffect, useRef, useState } from "react";
import { ModelPicker } from "./model-picker.tsx";
import { useChat } from "./use-chat.ts";

export function App() {
  const chat = useChat();
  const [draft, setDraft] = useState("");
  const transcript = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const view = chat.view;
  useEffect(() => {
    if (view && follow.current && transcript.current) {
      transcript.current.scrollTop = transcript.current.scrollHeight;
    }
  }, [view]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || !chat.connected || chat.sending || view?.busy) return;
    follow.current = true;
    if (await chat.send(text))
      setDraft((current) => (current === draft ? "" : current));
  };

  return (
    <div className="workspace">
      <aside className="sidebar">
        <a className="wordmark" href="/">
          domos<span>.</span>
        </a>
        <div className="sidebar-label">个人空间</div>
        <div className="active-chat">
          <span className="chat-mark">D</span>与 Domos 对话
        </div>
        <p className="sidebar-note">
          想法、问题和下一步。
          <br />
          从这里开始。
        </p>
        <div className="sidebar-footer">
          <span className="status-dot" />
          本地工作空间
        </div>
      </aside>
      <main className="conversation">
        <header className="topbar">
          <div>
            <strong>与 Domos 对话</strong>
            <ModelPicker
              model={view?.model ?? null}
              connected={chat.connected}
            />
          </div>
          <span className="connection" role="status">
            {chat.connected ? "已连接" : view ? "正在重连…" : "正在连接…"}
          </span>
        </header>
        <div
          className="transcript"
          ref={transcript}
          onScroll={() => {
            const element = transcript.current;
            if (element)
              follow.current =
                element.scrollHeight -
                  element.scrollTop -
                  element.clientHeight <
                80;
          }}
        >
          {!view?.messages.length && (
            <section className="welcome">
              <div className="eyebrow">DOMOS / YOUR PERSONAL SPACE</div>
              <h1>从一个想法开始。</h1>
              <p>
                说说你正在想什么，
                <br />
                我们一起把下一步理清楚。
              </p>
            </section>
          )}
          <div
            className="messages"
            role="log"
            aria-label="聊天记录"
            aria-live="off"
          >
            {view?.messages.map((message) => (
              <article
                className={`message ${message.role}`}
                key={message.id}
                aria-label={
                  message.role === "user" ? "你的消息" : "Domos 的回复"
                }
              >
                <div className="message-author">
                  {message.role === "user" ? "你" : "Domos"}
                </div>
                <div className="message-text">{message.text}</div>
                {message.stopped && <div className="message-note">已停止</div>}
              </article>
            ))}
            {view?.busy && (
              <p className="working" role="status">
                Domos 正在回复…
              </p>
            )}
          </div>
        </div>
        <footer className="composer-area">
          {(chat.error || view?.error) && (
            <p className="error" role="alert">
              {chat.error || view?.error}
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
            <textarea
              id="message"
              placeholder="和 Domos 说点什么…"
              value={draft}
              rows={3}
              onChange={(event) => setDraft(event.target.value)}
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
              {view?.busy ? (
                <button
                  type="button"
                  className="stop"
                  disabled={chat.stopping || !chat.connected}
                  onClick={() => void chat.stop()}
                >
                  {chat.stopping ? "正在停止…" : "停止生成"}
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!draft.trim() || !chat.connected || chat.sending}
                >
                  {chat.sending ? "发送中…" : "发送"}
                  <span aria-hidden="true">↑</span>
                </button>
              )}
            </div>
          </form>
          <p className="composer-note">对话自动保存。重新打开，继续聊。</p>
        </footer>
      </main>
    </div>
  );
}
