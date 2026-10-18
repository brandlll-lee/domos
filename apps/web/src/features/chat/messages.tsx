import type { TranscriptItem } from "@domos/agent/transcript";
import type { ChatView } from "@domos/agent/view";
import { ActivityText } from "@domos/ui/activity";
import { Button } from "@domos/ui/controls";
import { MessageBubble } from "@domos/ui/message";
import { ArrowDownIcon } from "@phosphor-icons/react/dist/csr/ArrowDown";
import type { ReactNode } from "react";
import { ExecutionActivity } from "./activity.tsx";
import { Attachments } from "./attachments.tsx";
import { chatCopy } from "./copy.ts";
import { MessageContent } from "./message-content.tsx";
import { useTranscript } from "./use-transcript.ts";

export function Messages({
  view,
  botName,
  createdAt,
  items,
  welcome,
}: {
  view: ChatView | null;
  botName: string;
  createdAt?: number;
  items: TranscriptItem[];
  welcome?: ReactNode;
}) {
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
            <ActivityText active>{chatCopy.loading}</ActivityText>
          </p>
        ) : (
          !view.messages.length &&
          createdAt !== undefined && (
            <time
              className="conversation-time"
              dateTime={new Date(createdAt).toISOString()}
              title="创建时间"
            >
              {new Date(createdAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </time>
          )
        )}
        {view && !view.messages.length && welcome}
        <div
          className="messages"
          ref={transcript.content}
          role="log"
          aria-label={chatCopy.history}
          aria-live="off"
        >
          {view &&
            items.map((item) => {
              if (item.kind === "activity")
                return item.status === "running" ? null : (
                  <ExecutionActivity
                    key={`activity:${item.id}`}
                    activity={item}
                  />
                );
              if (item.kind === "attachments")
                return (
                  <div className="delivered-files" key={item.id}>
                    <Attachments botId={view.id} files={item.files} />
                  </div>
                );
              const { message } = item;
              return (
                <article
                  className={`message ${message.role}`}
                  key={message.id}
                  aria-label={
                    message.role === "user"
                      ? chatCopy.userMessage
                      : message.role === "assistant"
                        ? chatCopy.assistantMessage(botName)
                        : chatCopy.toolOutput
                  }
                >
                  <MessageBubble
                    side={message.role === "user" ? "outgoing" : "incoming"}
                  >
                    <MessageContent
                      content={message.content}
                      user={message.role === "user"}
                    />
                    {message.attachments?.length ? (
                      <Attachments
                        botId={view.id}
                        files={message.attachments}
                      />
                    ) : null}
                  </MessageBubble>
                </article>
              );
            })}
          <p className="sr-only" role="status">
            {!view?.busy && view?.messages.length ? chatCopy.complete : ""}
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
