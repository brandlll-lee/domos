import { type ChatMessage, messageText } from "@domos/agent/messages";
import type { TranscriptItem } from "@domos/agent/transcript";
import { Button } from "@domos/ui/controls";
import { ActionMenu } from "@domos/ui/menu";
import { InlineNotice, MessageBubble } from "@domos/ui/message";
import { ScrollArea } from "@domos/ui/scroll-area";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import {
  Fragment,
  memo,
  type ReactNode,
  useDeferredValue,
  useMemo,
  ViewTransition,
} from "react";
import { Approval } from "./approvals.tsx";
import { Attachments } from "./attachments.tsx";
import { chatCopy } from "./copy.ts";
import { ErrorMessage } from "./error-message.tsx";
import { timeBreak } from "./format.ts";
import { MaterialChips } from "./material-chips.tsx";
import { MessageBody } from "./message-body.tsx";
import { MessageDetail } from "./message-detail.tsx";
import { TakeoverCard } from "./takeover-card.tsx";
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
      <div
        className="task-notice"
        data-state={item.status}
        data-transcript-key={key}
      >
        <ErrorMessage>{item.error ?? chatCopy.taskFailed}</ErrorMessage>
      </div>
    );
  if (item.kind === "attachments")
    return (
      <div className="delivered-files" data-transcript-key={key}>
        <MessageBubble side="incoming">
          <Attachments botId={botId} files={item.files} />
        </MessageBubble>
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
          : message.approval
            ? `${botName} 的${message.approval.request.kind === "question" ? "提问" : "审批"}`
            : message.takeover
              ? `${botName} 的接管请求`
              : chatCopy.assistantMessage(botName)
      }
    >
      {message.routine && message.role === "assistant" && (
        <InlineNotice
          className="routine-source"
          align="center"
          icon="◷"
          onClick={
            message.routine.turnId
              ? () =>
                  window.dispatchEvent(
                    new CustomEvent("domos:work-open", {
                      detail: { botId, turnId: message.routine?.turnId },
                    }),
                  )
              : undefined
          }
        >
          {message.routine.title} · 计划{" "}
          {new Date(message.routine.scheduledAt).toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </InlineNotice>
      )}

      {message.notice ? (
        <InlineNotice align="center">{message.notice.text}</InlineNotice>
      ) : message.approval ? (
        message.approval.state === "pending" ? (
          <MessageBubble side="incoming">
            <Approval botId={botId} message={message} />
          </MessageBubble>
        ) : (
          <Approval botId={botId} message={message} />
        )
      ) : message.takeover ? (
        <MessageBubble side="incoming">
          <TakeoverCard botId={botId} message={message} />
        </MessageBubble>
      ) : (
        <MessageBubble side={message.role === "user" ? "outgoing" : "incoming"}>
          <MessageBody>
            {!!message.attachments?.length && (
              <Attachments
                botId={botId}
                files={message.attachments}
                caption={messageText(message)}
              />
            )}
            <MaterialChips materials={message.materials} />
            <MessageDetail botId={botId} message={message} />
          </MessageBody>
        </MessageBubble>
      )}
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
  processing,
  retry,
  botName,
  createdAt,
  items,
  welcome,
  onResend,
  sentRequest,
  hasMore,
  loadingEarlier,
  onEarlier,
}: {
  botId: number;
  ready: boolean;
  busy: boolean;
  processing: boolean;
  retry?: string | null;
  botName: string;
  createdAt?: number;
  items: TranscriptItem[];
  welcome?: ReactNode;
  onResend: (message: ChatMessage) => void;
  sentRequest?: string;
  hasMore?: boolean;
  loadingEarlier?: boolean;
  onEarlier?: () => Promise<void>;
}) {
  const received = useMemo(
    () => ({ items, ready, processing, retry, sentRequest }),
    [items, ready, processing, retry, sentRequest],
  );
  const deferred = useDeferredValue(received);
  const shown =
    !deferred.ready || deferred.sentRequest !== sentRequest
      ? received
      : deferred;
  const typing = shown.ready && (shown.processing || Boolean(shown.retry));
  const transcript = useTranscript(
    shown.items,
    shown.ready,
    shown.sentRequest,
    typing,
    botId,
  );
  const motion =
    !transcript.initialized || document.hidden
      ? { default: "none" }
      : { enter: "chat-enter", update: "chat-layout", exit: "chat-exit" };
  const separators = new Map<string, { at: number; label: string }>();
  let previousAt: number | undefined;
  for (const item of shown.items) {
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
        {!shown.ready ? (
          <p className="working" role="status">
            {chatCopy.loading}
          </p>
        ) : (
          !shown.items.length &&
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
        {shown.ready && !shown.items.length && welcome}
        <div
          className="messages"
          ref={transcript.content}
          role="log"
          aria-label={chatCopy.history}
          aria-live="off"
        >
          {(transcript.hasEarlier || hasMore) && (
            <Button
              className="history-page"
              variant="ghost"
              size="small"
              pending={loadingEarlier}
              onClick={() =>
                void transcript.loadEarlier(
                  transcript.hasEarlier ? undefined : onEarlier,
                )
              }
            >
              {chatCopy.earlier}
            </Button>
          )}
          {shown.ready &&
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
                  <ViewTransition {...motion}>
                    <MessageRow
                      item={item}
                      botId={botId}
                      botName={botName}
                      onResend={onResend}
                    />
                  </ViewTransition>
                </Fragment>
              );
            })}
          {typing && transcript.atLatest && (
            <ViewTransition {...motion}>
              <TypingDots
                label={chatCopy.typing(botName)}
                status={shown.retry}
              />
            </ViewTransition>
          )}
          <p className="sr-only" role="status">
            {!busy && shown.items.length ? chatCopy.complete : ""}
          </p>
        </div>
      </ScrollArea>
      {!transcript.atBottom && (
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="return-latest"
          aria-label={transcript.unread ? chatCopy.newMessage : chatCopy.latest}
          title={chatCopy.latest}
          onClick={transcript.jumpToLatest}
        >
          <CaretDownIcon />
        </Button>
      )}
    </div>
  );
});
