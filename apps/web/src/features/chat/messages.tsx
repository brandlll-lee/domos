import type { ChatView } from "@domos/agent/view";
import { Button } from "@domos/ui/controls";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { chatCopy } from "./copy.ts";
import { MessageContent } from "./message-content.tsx";

export function Messages({ view }: { view: ChatView | null }) {
  const results = new Map(
    view?.messages.flatMap((message) =>
      message.role === "toolResult" && message.toolCallId
        ? [[message.toolCallId, message] as const]
        : [],
    ),
  );
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
          {chatCopy.loading}
        </p>
      ) : (
        !view.messages.length && (
          <section className="welcome">
            <h1>{chatCopy.welcome}</h1>
          </section>
        )
      )}
      <div
        className="messages"
        role="log"
        aria-label={chatCopy.history}
        aria-live="off"
      >
        {view?.messages.map((message) => (
          <article
            className={`message ${message.role}`}
            key={message.id}
            aria-label={
              message.role === "user"
                ? chatCopy.userMessage
                : message.role === "assistant"
                  ? chatCopy.assistantMessage
                  : chatCopy.toolOutput
            }
          >
            <div className="message-body">
              <MessageContent message={message} results={results} />
            </div>
            {message.stopped && (
              <div className="message-note">{chatCopy.stopped}</div>
            )}
          </article>
        ))}
        <p className={view?.busy ? "working" : "sr-only"} role="status">
          {view?.busy
            ? chatCopy.working
            : view?.messages.length
              ? chatCopy.complete
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
          {chatCopy.latest}
        </Button>
      )}
    </div>
  );
}
