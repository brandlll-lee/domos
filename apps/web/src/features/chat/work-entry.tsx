import type { ChatMessage } from "@domos/agent/messages";
import { Disclosure } from "@domos/ui/disclosure";
import { useState } from "react";
import { Attachments } from "./attachments.tsx";
import { MessageContent } from "./message-content.tsx";
import { MessageDetail } from "./message-detail.tsx";
import {
  timelineState,
  type WorkItem,
  workStatus,
  workTime,
} from "./work-state.ts";
import { WorkStep } from "./work-timeline.tsx";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown) {
  return typeof value === "string" ? value : "";
}
function blocks(value: unknown): ChatMessage["content"] {
  if (typeof value === "string")
    return [{ type: "text", text: value, key: "output" }];
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index): ChatMessage["content"] => {
    const part = object(entry);
    if (part.type === "content") return blocks(part.content);
    if (part.type === "text" && typeof part.text === "string")
      return [{ type: "text", text: part.text, key: String(index) }];
    if (
      part.type === "image" &&
      typeof part.data === "string" &&
      typeof part.mimeType === "string"
    )
      return [
        {
          type: "image",
          data: part.data,
          mimeType: part.mimeType,
          key: String(index),
        },
      ];
    return [];
  });
}

function ToolRecord({
  item,
  message,
  botId,
}: {
  item: WorkItem;
  message?: ChatMessage;
  botId: number;
}) {
  const native = message?.native ?? {};
  const input = item.input ?? {};
  const result = object(native.result);
  const output = blocks(
    native.aggregatedOutput ??
      result.content ??
      object(native.rawOutput).content ??
      native.rawOutput ??
      native.content,
  );
  const content =
    message?.content.filter(
      (part) => part.type !== "text" || part.text.trim(),
    ) ?? [];
  const command = text(native.command ?? input.command);
  const changes = native.changes ?? input.changes;
  const action = object(native.action);
  const queries = action.queries ?? action.query ?? native.query ?? input.query;
  const paths = native.locations;
  const body = content.length ? content : output;
  const agents = object(native.agentsStates);
  return (
    <>
      {command && (
        <div className="work-terminal">
          <div className="work-terminal-line">
            <span>IN</span>
            <pre>
              <code>{command}</code>
            </pre>
          </div>
          {body.length > 0 && (
            <div className="work-terminal-line">
              <span>OUT</span>
              <pre>
                <code>
                  {body
                    .filter((part) => part.type === "text")
                    .map((part) => part.text)
                    .join("\n")}
                </code>
              </pre>
            </div>
          )}
          {typeof native.exitCode === "number" && (
            <div className="work-exit">退出码 {native.exitCode}</div>
          )}
        </div>
      )}
      {Boolean(queries) && (
        <p className="work-query">
          {Array.isArray(queries) ? queries.join(" · ") : text(queries)}
        </p>
      )}
      {Array.isArray(changes) &&
        changes.map((value) => {
          const change = object(value);
          return (
            <div className="work-file" key={text(change.path)}>
              <code>{text(change.path)}</code>
              {typeof change.diff === "string" && <pre>{change.diff}</pre>}
            </div>
          );
        })}
      {Array.isArray(paths) &&
        paths.map((value) => (
          <code
            key={`${text(object(value).path)}:${String(object(value).line ?? "")}`}
          >
            {text(object(value).path)}
          </code>
        ))}
      {!command &&
        !queries &&
        !changes &&
        Object.entries(input).map(([key, value]) =>
          typeof value === "string" ? (
            <p key={key}>
              <code>{key}</code> {value}
            </p>
          ) : null,
        )}
      {!command && <MessageContent content={body} />}
      {Object.entries(agents).map(([id, value]) => (
        <div key={id} className="work-agent">
          <code>{id}</code>
          <span>{text(object(value).status)}</span>
          <p>{text(object(value).message)}</p>
        </div>
      ))}
      {Boolean(native.error) && (
        <pre role="alert">
          {text(object(native.error).message) || text(native.error)}
        </pre>
      )}
      {native.kind === "edit" &&
        Array.isArray(native.content) &&
        native.content.map((value) => {
          const part = object(value);
          return part.type === "diff" ? (
            <div className="work-file" key={text(part.path)}>
              <code>{text(part.path)}</code>
              <pre>{text(part.newText)}</pre>
            </div>
          ) : null;
        })}
      {!command &&
        !queries &&
        !changes &&
        !content.length &&
        !output.length &&
        Object.keys(native).length > 0 && (
          <Disclosure label="原始记录">
            <pre>{JSON.stringify(native, null, 2)}</pre>
          </Disclosure>
        )}
      {message?.attachments?.length ? (
        <Attachments botId={botId} files={message.attachments} />
      ) : null}
    </>
  );
}

export function WorkEntry({
  item,
  botId,
  connected,
}: {
  item: WorkItem;
  botId: number;
  connected: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const event = item.message.activity;
  const native = item.result?.native;
  const duration = native?.durationMs;
  const time =
    typeof duration === "number" && Number.isFinite(duration) && duration >= 0
      ? workTime(0, duration)
      : workTime(item.startedAt, item.endedAt);
  return (
    <WorkStep
      connected={connected}
      parentId={item.message.parentId}
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      step={{
        id: item.id,
        title: item.label,
        state: timelineState(item.status),
        label: workStatus(item.status),
        time:
          item.startedAt === undefined
            ? "时间未提供"
            : new Date(item.startedAt).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
              }),
        duration: time === "—" ? "耗时未知" : time,
        content: (
          <>
            {expanded &&
              (item.kind === "text" ? (
                <MessageContent
                  content={typeof item.detail === "string" ? [] : item.detail}
                />
              ) : item.kind === "thinking" ? (
                <MessageContent
                  content={[
                    {
                      type: "text",
                      text: typeof item.detail === "string" ? item.detail : "",
                      key: item.id,
                    },
                  ]}
                />
              ) : item.kind === "toolCall" ? (
                item.result ? (
                  <MessageDetail botId={botId} message={item.result}>
                    {(message) => (
                      <ToolRecord item={item} message={message} botId={botId} />
                    )}
                  </MessageDetail>
                ) : (
                  <ToolRecord item={item} botId={botId} />
                )
              ) : event?.type === "plan" ? (
                <ul className="work-plan">
                  {event.plan.map((step) => (
                    <li key={step.step} data-state={step.status}>
                      {step.step}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  {typeof item.detail === "string" && item.detail
                    ? item.detail
                    : item.label}
                </p>
              ))}
          </>
        ),
      }}
    />
  );
}
