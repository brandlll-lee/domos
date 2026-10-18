import type { ChatMessage } from "@domos/agent/messages";
import type { TranscriptItem } from "@domos/agent/transcript";
import { ActivityText } from "@domos/ui/activity";
import { Button } from "@domos/ui/controls";
import { MessageBubble } from "@domos/ui/message";
import { ScrollArea } from "@domos/ui/scroll-area";
import { ArrowDownIcon } from "@phosphor-icons/react/dist/csr/ArrowDown";
import { memo, type ReactNode } from "react";
import { ExecutionActivity } from "./activity.tsx";
import { Attachments } from "./attachments.tsx";
import { chatCopy } from "./copy.ts";
import { MessageContent } from "./message-content.tsx";
import { useTranscript } from "./use-transcript.ts";

const MessageRow = memo(function MessageRow({
  item,
  botId,
  botName,
  original,
  onRetry,
}: {
  item: TranscriptItem;
  botId: number;
  botName: string;
  original?: ChatMessage;
  onRetry: (message: ChatMessage) => void;
}) {
  const key = `${item.kind}:${item.id}`;
  if (item.kind === "activity")
    return (
      <div data-transcript-key={key}>
        <ExecutionActivity
          activity={item}
          onRetry={original ? () => onRetry(original) : undefined}
        />
      </div>
    );
  if (item.kind === "attachments")
    return (
      <div className="delivered-files" data-transcript-key={key}>
        <Attachments botId={botId} files={item.files} />
      </div>
    );
  const { message } = item;
  return (
    <article
      className={`message ${message.role}`}
      data-transcript-key={key}
      aria-label={
        message.role === "user"
          ? chatCopy.userMessage
          : chatCopy.assistantMessage(botName)
      }
    >
      <MessageBubble side={message.role === "user" ? "outgoing" : "incoming"}>
        <MessageContent
          content={message.content}
          user={message.role === "user"}
        />
        {!!message.attachments?.length && (
          <Attachments botId={botId} files={message.attachments} />
        )}
      </MessageBubble>
    </article>
  );
});

export const Messages = memo(function Messages({
  botId,
  ready,
  busy,
  botName,
  createdAt,
  items,
  welcome,
  onRetry,
}: {
  botId: number;
  ready: boolean;
  busy: boolean;
  botName: string;
  createdAt?: number;
  items: TranscriptItem[];
  welcome?: ReactNode;
  onRetry: (message: ChatMessage) => void;
}) {
  const transcript = useTranscript(items, ready);
  const originals = new Map(
    items.flatMap((item) =>
      item.kind === "message" && item.message.role === "user"
        ? [[item.message.turnId, item.message] as const]
        : [],
    ),
  );
  return (
    <div className="transcript-pane">
      <ScrollArea
        className="transcript-scroll"
        viewportClassName="transcript"
        viewportRef={transcript.viewport}
        onScrollCapture={(event) => {
          if (event.target === transcript.viewport.current)
            transcript.onScroll();
        }}
      >
        {!ready ? (
          <p className="working" role="status">
            <ActivityText active>{chatCopy.loading}</ActivityText>
          </p>
        ) : (
          !items.length &&
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
        {ready && !items.length && welcome}
        <div
          className="messages"
          ref={transcript.content}
          role="log"
          aria-label={chatCopy.history}
          aria-live="off"
        >
          {transcript.hasEarlier && (
            <Button
              className="history-page"
              variant="ghost"
              size="small"
              onClick={transcript.loadEarlier}
            >
              {chatCopy.earlier}
            </Button>
          )}
          {ready &&
            transcript.visible.map((item) => (
              <MessageRow
                key={`${item.kind}:${item.id}`}
                item={item}
                botId={botId}
                botName={botName}
                original={
                  item.kind === "activity" && !busy
                    ? originals.get(item.id)
                    : undefined
                }
                onRetry={onRetry}
              />
            ))}
          <p className="sr-only" role="status">
            {!busy && items.length ? chatCopy.complete : ""}
          </p>
        </div>
      </ScrollArea>
      {!transcript.atBottom && (
        <Button
          type="button"
          variant="secondary"
          size={transcript.unread ? "small" : "icon"}
          className="return-latest"
          aria-label={transcript.unread ? chatCopy.newMessage : chatCopy.latest}
          title={chatCopy.latest}
          onClick={transcript.jumpToLatest}
        >
          <ArrowDownIcon />
          {transcript.unread && chatCopy.newMessage}
        </Button>
      )}
    </div>
  );
});
