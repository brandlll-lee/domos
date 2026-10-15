import type { ChatView } from "@domos/agent/view";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../../ui/controls.tsx";

export function Messages({ view }: { view: ChatView | null }) {
  const transcript = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        follow.current = entry.isIntersecting;
        setAtBottom(entry.isIntersecting);
      },
      { root: transcript.current, threshold: 1 },
    );
    if (bottom.current) observer.observe(bottom.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (view && follow.current && transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [view]);
  return (
    <div className="transcript" ref={transcript}>
      {!view ? (
        <p className="working" role="status">
          正在加载对话…
        </p>
      ) : (
        !view.messages.length && (
          <section className="welcome">
            <div className="eyebrow">DOMOS / YOUR PERSONAL SPACE</div>
            <h1>从一个想法开始。</h1>
            <p>
              说说你正在想什么，
              <br />
              我们一起把下一步理清楚。
            </p>
          </section>
        )
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
            aria-label={message.role === "user" ? "你的消息" : "Domos 的回复"}
          >
            <div className="message-author">
              {message.role === "user" ? "你" : "Domos"}
            </div>
            <div className="message-text">{message.text}</div>
            {message.stopped && <div className="message-note">已停止</div>}
          </article>
        ))}
        <p className="working" role="status">
          {view?.busy
            ? "Domos 正在回复…"
            : view?.messages.length
              ? "回复已结束"
              : ""}
        </p>
      </div>
      <div ref={bottom} className="transcript-end" />
      {!atBottom && (
        <Button
          type="button"
          variant="secondary"
          className="return-latest"
          onClick={() => {
            follow.current = true;
            if (transcript.current)
              transcript.current.scrollTop = transcript.current.scrollHeight;
          }}
        >
          返回最新
        </Button>
      )}
    </div>
  );
}
