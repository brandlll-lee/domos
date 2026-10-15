import type { ChatView } from "@domos/agent/view";
import { Button } from "@domos/ui/controls";
import { MessageBubble } from "@domos/ui/message";
import { ArrowDownIcon } from "@phosphor-icons/react/dist/csr/ArrowDown";
import { chatCopy } from "./copy.ts";
import { MessageContent } from "./message-content.tsx";
import { useTranscript } from "./use-transcript.ts";

export function Messages({ view }: { view: ChatView | null }) {
  const results = new Map(
    view?.messages.flatMap((message) =>
      message.role === "toolResult" && message.toolCallId
        ? [[message.toolCallId, message] as const]
        : [],
    ),
  );
  const transcript = useTranscript(view);
  return (
    <div className="transcript-pane">
      <div
        className="transcript"
        ref={transcript.viewport}
        onScroll={transcript.onScroll}
      >
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
          ref={transcript.content}
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
              <MessageBubble
                side={message.role === "user" ? "outgoing" : "incoming"}
              >
                <MessageContent message={message} results={results} />
              </MessageBubble>
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
      </div>
      {!transcript.atBottom && (
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="return-latest"
          aria-label={chatCopy.latest}
          title={chatCopy.latest}
          onClick={transcript.jumpToLatest}
        >
          <ArrowDownIcon />
        </Button>
      )}
    </div>
  );
}
