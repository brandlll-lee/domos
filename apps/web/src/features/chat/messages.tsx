import type { ChatMessage } from "@domos/agent/messages";
import type { TranscriptItem } from "@domos/agent/transcript";
import { Button } from "@domos/ui/controls";
import { MessageBubble } from "@domos/ui/message";
import { ScrollArea } from "@domos/ui/scroll-area";
import { ArrowDownIcon } from "@phosphor-icons/react/dist/csr/ArrowDown";
import { Fragment, memo, type ReactNode } from "react";
import { Attachments } from "./attachments.tsx";
import { chatCopy } from "./copy.ts";
import { clockTime, timeBreak } from "./format.ts";
import { MessageContent } from "./message-content.tsx";
import { TaskNotice } from "./task-notice.tsx";
import { TypingDots } from "./typing-dots.tsx";
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
  if (item.kind === "notice")
    return (
      <div data-transcript-key={key}>
        <TaskNotice
          notice={item}
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
        {message.role === "user" &&
          message.timestamp !== undefined &&
          Number.isFinite(message.timestamp) && (
            <time
              className="message-time"
              dateTime={new Date(message.timestamp).toISOString()}
            >
              {clockTime(message.timestamp)}
            </time>
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
  avatar,
  createdAt,
  items,
  welcome,
  onRetry,
}: {
  botId: number;
  ready: boolean;
  busy: boolean;
  botName: string;
  avatar: string;
  createdAt?: number;
  items: TranscriptItem[];
  welcome?: ReactNode;
  onRetry: (message: ChatMessage) => void;
}) {
  const transcript = useTranscript(items, ready);
  const separators = new Map<string, { at: number; label: string }>();
  let previousAt: number | undefined;
  for (const item of items) {
    if (item.kind !== "message") continue;
    const at = item.message.timestamp;
    const label = timeBreak(previousAt, at);
    if (label !== null && at !== undefined)
      separators.set(`${item.kind}:${item.id}`, { at, label });
    if (at !== undefined && Number.isFinite(at)) previousAt = at;
  }
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
            {chatCopy.loading}
          </p>
        ) : (
          !items.length &&
          createdAt !== undefined && (
            <div className="conversation-time">
              <time
                dateTime={new Date(createdAt).toISOString()}
                title="创建时间"
              >
                {timeBreak(undefined, createdAt)}
              </time>
            </div>
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
            transcript.visible.map((item) => {
              const key = `${item.kind}:${item.id}`;
              const separator = separators.get(key);
              return (
                <Fragment key={key}>
                  {separator && (
                    <div className="conversation-time">
                      <time dateTime={new Date(separator.at).toISOString()}>
                        {separator.label}
                      </time>
                    </div>
                  )}
                  <MessageRow
                    item={item}
                    botId={botId}
                    botName={botName}
                    original={
                      item.kind === "notice" && !busy
                        ? originals.get(item.id)
                        : undefined
                    }
                    onRetry={onRetry}
                  />
                </Fragment>
              );
            })}
          {ready && busy && transcript.atLatest && (
            <TypingDots avatar={avatar} label={chatCopy.typing(botName)} />
          )}
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
