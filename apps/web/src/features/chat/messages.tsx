import type { ChatMessage } from "@domos/agent/messages";
import type { TranscriptItem } from "@domos/agent/transcript";
import { Button } from "@domos/ui/controls";
import { ActionMenu } from "@domos/ui/menu";
import { MessageBubble } from "@domos/ui/message";
import { ScrollArea } from "@domos/ui/scroll-area";
import { ArrowDownIcon } from "@phosphor-icons/react/dist/csr/ArrowDown";
import { Fragment, memo, type ReactNode } from "react";
import { Attachments } from "./attachments.tsx";
import { chatCopy } from "./copy.ts";
import { timeBreak } from "./format.ts";
import { MaterialChips } from "./material-chips.tsx";
import { MessageBody } from "./message-body.tsx";
import { MessageContent } from "./message-content.tsx";
import { TaskNotice } from "./task-notice.tsx";
import { TypingDots } from "./typing-dots.tsx";
import { useTranscript } from "./use-transcript.ts";

const MessageRow = memo(function MessageRow({
  item,
  botId,
  botName,
  onResend,
}: {
  item: TranscriptItem;
  botId: number;
  botName: string;
  onResend: (message: ChatMessage) => void;
}) {
  const key = `${item.kind}:${item.id}`;
  if (item.kind === "notice")
    return (
      <div data-transcript-key={key}>
        <TaskNotice notice={item} />
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
        <MessageBody>
          {!!message.attachments?.length && (
            <Attachments botId={botId} files={message.attachments} />
          )}
          <MaterialChips materials={message.materials} />
          <MessageContent
            content={message.content}
            user={message.role === "user"}
          />
        </MessageBody>
      </MessageBubble>
      {message.role === "user" && (
        <ActionMenu
          label={chatCopy.messageActions}
          items={[
            { label: chatCopy.resend, onSelect: () => onResend(message) },
          ]}
        />
      )}
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
  onResend,
  sentRequest,
}: {
  botId: number;
  ready: boolean;
  busy: boolean;
  botName: string;
  createdAt?: number;
  items: TranscriptItem[];
  welcome?: ReactNode;
  onResend: (message: ChatMessage) => void;
  sentRequest?: string;
}) {
  const transcript = useTranscript(items, ready, sentRequest);
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
                    onResend={onResend}
                  />
                </Fragment>
              );
            })}
          {ready && busy && transcript.atLatest && (
            <TypingDots label={chatCopy.typing(botName)} />
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
