import type { BotPresence } from "@domos/agent/bots";
import { type ChatMessage, messageText } from "@domos/agent/messages";
import type { TranscriptItem } from "@domos/agent/transcript";
import type { ChatView } from "@domos/agent/view";
import { Button } from "@domos/ui/controls";
import { Loading } from "@domos/ui/loading";
import { ActionMenu } from "@domos/ui/menu";
import { InlineNotice, MessageBubble } from "@domos/ui/message";
import { ScrollArea } from "@domos/ui/scroll-area";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import {
  Fragment,
  memo,
  type ReactNode,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  ViewTransition,
} from "react";
import { fileUrl } from "../files/actions.ts";
import { Approval } from "./approvals.tsx";
import { Attachments } from "./attachments.tsx";
import { openChatTarget, useAttention } from "./attention.tsx";
import { BotReference } from "./bot-reference.tsx";
import { chatCopy } from "./copy.ts";
import { ErrorMessage } from "./error-message.tsx";
import { timeBreak } from "./format.ts";
import { LinkCard } from "./link-card.tsx";
import { MaterialChips } from "./material-chips.tsx";
import { materialTokens } from "./material-tokens.tsx";
import { MessageBody } from "./message-body.tsx";
import { MessageContent } from "./message-content.tsx";
import { MessageDetail } from "./message-detail.tsx";
import type { MessageTarget } from "./message-target.ts";
import { TakeoverCard } from "./takeover-card.tsx";
import { TypingDots } from "./typing-dots.tsx";
import { useTranscript } from "./use-transcript.ts";

const MessageRow = memo(function MessageRow({
  item,
  botId,
  botName,
  bots,
  onResend,
}: {
  item: TranscriptItem;
  botId: number;
  botName: string;
  bots?: BotPresence[];
  onResend: (message: ChatMessage) => void;
}) {
  const key = `${item.kind}:${item.id}`;
  if (item.kind === "notice")
    return (
      <div
        className="task-notice"
        data-state={item.status}
        data-transcript-key={key}
        data-message-id={`failure:${item.id}`}
        data-session-id={item.sessionId ?? botId}
        data-incoming="true"
      >
        <ErrorMessage
          onInspect={() =>
            window.dispatchEvent(
              new CustomEvent("domos:work-open", {
                detail: { botId: item.sessionId ?? botId, turnId: item.id },
              }),
            )
          }
        >
          {item.error ?? chatCopy.taskFailed}
        </ErrorMessage>
      </div>
    );
  if (item.kind === "attachments")
    return (
      <div
        className="delivered-files"
        data-transcript-key={key}
        data-message-id={item.id}
        data-session-id={item.sessionId ?? botId}
        data-incoming="true"
      >
        <div className="attachment-message">
          <Attachments
            botId={item.sessionId ?? botId}
            files={item.files}
            inline
            author={item.author ?? bots?.find((bot) => bot.id === botId)}
          />
        </div>
      </div>
    );
  const { message } = item;
  botId = message.sessionId ?? botId;
  botName = message.author?.name ?? botName;
  return (
    <article
      className={`message ${message.role}`}
      data-transcript-key={key}
      data-message-id={message.id}
      data-session-id={botId}
      data-incoming={
        (message.role === "assistant" && message.cursor) ||
        message.approval ||
        message.takeover
          ? "true"
          : undefined
      }
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
      {message.author && (
        <div className="message-author">
          <BotReference bot={message.author} />
        </div>
      )}
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

      {message.link ? (
        <LinkCard botId={botId} link={message.link} />
      ) : message.notice ? (
        <InlineNotice align="center">{message.notice.text}</InlineNotice>
      ) : message.approval ? (
        (message.approval.state === "pending" &&
          message.approval.request.kind === "permission") ||
        message.approval.request.draft ||
        message.approval.request.credential ? (
          <MessageBubble side="incoming">
            <Approval botId={botId} message={message} />
          </MessageBubble>
        ) : (
          <Approval botId={botId} message={message} />
        )
      ) : message.takeover ? (
        <TakeoverCard botId={botId} message={message} />
      ) : (
        <MessageDetail botId={botId} message={message}>
          {(resolved) => {
            const files = !!resolved.attachments?.length;
            const images = resolved.content.filter(
              (part) => part.type === "image",
            );
            const attachments = files && (
              <Attachments
                botId={botId}
                files={resolved.attachments ?? []}
                caption={messageText(resolved)}
                inline={resolved.role === "assistant"}
                author={
                  resolved.role === "user"
                    ? "user"
                    : (resolved.author ?? bots?.find((bot) => bot.id === botId))
                }
              />
            );
            return (
              <div className="message-parts">
                {(files || images.length > 0) && (
                  <div className="attachment-message">
                    {attachments}
                    <MessageContent content={images} />
                  </div>
                )}
                {(messageText(resolved).trim() ||
                  materialTokens(resolved.materials).length > 0 ||
                  resolved.reply) && (
                  <MessageBubble
                    side={resolved.role === "user" ? "outgoing" : "incoming"}
                  >
                    <MessageBody>
                      {resolved.reply && (
                        <button
                          type="button"
                          className="message-reply"
                          aria-label={`回复「${resolved.reply.title}」`}
                          onClick={() =>
                            openChatTarget({
                              chat:
                                window.location.hash.slice(1) || `bot/${botId}`,
                              botId,
                              sessionId: botId,
                              messageId: resolved.reply?.id ?? "",
                              cursor: resolved.reply?.cursor,
                            })
                          }
                        >
                          <span>↪ {resolved.reply.title}</span>
                          {resolved.reply.attachments?.[0] && (
                            <img
                              className="message-reply-image"
                              src={fileUrl(
                                botId,
                                resolved.reply.attachments[0].id,
                              )}
                              alt=""
                              loading="lazy"
                              decoding="async"
                            />
                          )}
                        </button>
                      )}
                      <MaterialChips materials={resolved.materials} />
                      <MessageContent
                        content={resolved.content.filter(
                          (part) => part.type !== "image",
                        )}
                        materials={resolved.materials}
                        user={resolved.role === "user"}
                      />
                    </MessageBody>
                  </MessageBubble>
                )}
              </div>
            );
          }}
        </MessageDetail>
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
  chatKey,
  ready,
  busy,
  processing,
  activity,
  bots,
  retry,
  botName,
  createdAt,
  items,
  welcome,
  onResend,
  sentRequest,
  hasMore,
  loadingEarlier,
  earlierError,
  onEarlier,
  target,
  readingHistory,
  onLatest,
  hasNewer,
  loadingNewer,
  newerError,
  onNewer,
  obscured = false,
}: {
  botId: number;
  chatKey?: string;
  ready: boolean;
  busy: boolean;
  processing: boolean;
  activity?: ChatView["activity"];
  bots?: BotPresence[];
  retry?: string | null;
  botName: string;
  createdAt?: number;
  items: TranscriptItem[];
  welcome?: ReactNode;
  onResend: (message: ChatMessage) => void;
  sentRequest?: string;
  hasMore?: boolean;
  loadingEarlier?: boolean;
  earlierError?: string;
  onEarlier?: () => Promise<void>;
  target?: MessageTarget;
  obscured?: boolean;
  readingHistory?: boolean;
  onLatest?: () => void;
  hasNewer?: boolean;
  loadingNewer?: boolean;
  newerError?: string;
  onNewer?: () => Promise<void>;
}) {
  const received = useMemo(
    () => ({
      items,
      ready,
      processing,
      activity,
      retry,
      sentRequest,
      readingHistory,
    }),
    [items, ready, processing, activity, retry, sentRequest, readingHistory],
  );
  const deferred = useDeferredValue(received);
  const shown =
    !deferred.ready ||
    deferred.sentRequest !== sentRequest ||
    deferred.readingHistory !== readingHistory ||
    target ||
    readingHistory ||
    (items.length > deferred.items.length &&
      items[0]?.id !== deferred.items[0]?.id)
      ? received
      : deferred;
  const working = shown.activity?.filter(
    (item) => item.processing || item.waiting,
  );
  const typing =
    shown.ready &&
    (working ? working.length > 0 : shown.processing || Boolean(shown.retry));
  const transcript = useTranscript(
    shown.items,
    shown.ready,
    shown.sentRequest,
    typing && !readingHistory,
    botId,
    target,
    chatKey,
  );
  const attention = useAttention();
  const read = useRef(attention?.read);
  read.current = attention?.read;
  const readRevision = attention?.revision;
  const viewport = transcript.viewport;
  useEffect(() => {
    const root = viewport.current;
    if (!root || !ready || obscured || readRevision === undefined) return;
    const visible = new Map<
      Element,
      { sessionId: number; messageId: string }
    >();
    const seen = new Set<string>();
    let timer: number | undefined;
    const collect = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (
          document.hidden ||
          !document.hasFocus() ||
          document.querySelector('[role="dialog"][aria-modal="true"]')
        )
          return;
        const messages = [...visible.values()].filter(
          (item) => !seen.has(`${item.sessionId}:${item.messageId}`),
        );
        for (const item of messages)
          seen.add(`${item.sessionId}:${item.messageId}`);
        if (messages.length)
          void read
            .current?.(
              chatKey?.startsWith("team:")
                ? `team/${chatKey.slice(5)}`
                : `bot/${botId}`,
              messages,
            )
            .then((saved) => {
              if (!saved)
                for (const item of messages)
                  seen.delete(`${item.sessionId}:${item.messageId}`);
            });
      }, 500);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const node = entry.target as HTMLElement;
          if (
            entry.isIntersecting &&
            entry.intersectionRatio >=
              Math.min(
                0.5,
                (root.clientHeight /
                  Math.max(1, entry.boundingClientRect.height)) *
                  0.5,
              )
          )
            visible.set(node, {
              sessionId: Number(node.dataset.sessionId),
              messageId: node.dataset.messageId ?? "",
            });
          else visible.delete(node);
        }
        collect();
      },
      { root, threshold: [0, 0.1, 0.25, 0.5, 1] },
    );
    const watched = new Set<Element>();
    const observe = () => {
      for (const node of watched)
        if (!root.contains(node)) {
          observer.unobserve(node);
          watched.delete(node);
          visible.delete(node);
        }
      for (const node of root.querySelectorAll<HTMLElement>(
        '[data-incoming="true"]',
      ))
        if (!watched.has(node)) {
          watched.add(node);
          observer.observe(node);
        }
    };
    observe();
    const changes = new MutationObserver(observe);
    changes.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-incoming"],
    });
    window.addEventListener("focus", collect);
    document.addEventListener("visibilitychange", collect);
    return () => {
      observer.disconnect();
      changes.disconnect();
      clearTimeout(timer);
      window.removeEventListener("focus", collect);
      document.removeEventListener("visibilitychange", collect);
    };
  }, [ready, obscured, viewport, botId, chatKey, readRevision]);
  const motion =
    !transcript.initialized || !transcript.atBottom || document.hidden
      ? { default: "none" }
      : { enter: "chat-enter", update: "chat-layout", exit: "chat-exit" };
  const separators = useMemo(() => {
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
    return separators;
  }, [shown.items]);
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
          <Loading label={chatCopy.loading} />
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
              {earlierError ? "重试读取历史消息" : chatCopy.earlier}
            </Button>
          )}
          {earlierError && (
            <p className="history-error" role="alert">
              {earlierError}
            </p>
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
                      bots={bots}
                      onResend={onResend}
                    />
                  </ViewTransition>
                </Fragment>
              );
            })}
          {(!transcript.atLatest || hasNewer) && (
            <Button
              className="history-page"
              variant="ghost"
              size="small"
              pending={loadingNewer}
              onClick={() =>
                void transcript.loadNewer(
                  transcript.atLatest ? onNewer : undefined,
                )
              }
            >
              {newerError ? "重试读取历史消息" : "查看较新的消息"}
            </Button>
          )}
          {newerError && (
            <p className="history-error" role="alert">
              {newerError}
            </p>
          )}
          {typing && !readingHistory && transcript.atLatest && (
            <ViewTransition {...motion}>
              {working ? (
                working.map((item) => {
                  const member = bots?.find((bot) => bot.id === item.botId);
                  return (
                    <TypingDots
                      key={`${item.sessionId}:${item.executionId}`}
                      author={
                        member
                          ? {
                              botId: member.id,
                              name: member.name,
                              avatar: member.avatar,
                            }
                          : undefined
                      }
                      label={`${member?.name ?? "成员"} ${chatCopy.botWorking}`}
                      status={item.waiting ?? item.retry}
                    />
                  );
                })
              ) : (
                <TypingDots
                  label={chatCopy.typing(botName)}
                  status={shown.retry}
                />
              )}
            </ViewTransition>
          )}
          <p className="sr-only" role="status">
            {!busy && shown.items.length ? chatCopy.complete : ""}
          </p>
        </div>
      </ScrollArea>
      {(!transcript.atBottom || readingHistory) && (
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="return-latest"
          aria-label={transcript.unread ? chatCopy.newMessage : chatCopy.latest}
          title={chatCopy.latest}
          onClick={readingHistory ? onLatest : transcript.jumpToLatest}
        >
          <CaretDownIcon />
        </Button>
      )}
    </div>
  );
});
