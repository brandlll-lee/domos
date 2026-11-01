import type { ChatMessage } from "@domos/agent/messages";
import { useState } from "react";
import { Attachments } from "./attachments.tsx";
import { MessageContent } from "./message-content.tsx";
import { MessageDetail } from "./message-detail.tsx";
import { type WorkItem, workStatus } from "./work-state.ts";

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
          <details>
            <summary>原始记录</summary>
            <pre>{JSON.stringify(native, null, 2)}</pre>
          </details>
        )}
      {message?.attachments?.length ? (
        <Attachments botId={botId} files={message.attachments} />
      ) : null}
    </>
  );
}

export function WorkEntry({ item, botId }: { item: WorkItem; botId: number }) {
  const [expanded, setExpanded] = useState(Boolean(item.input?.command));
  const event = item.message.activity;
  const time =
    item.startedAt === undefined ? undefined : new Date(item.startedAt);
  const input = item.input ?? {};
  const preview = text(
    input.description ?? input.file_path ?? input.path ?? input.query,
  );
  return (
    <li
      className="work-entry"
      data-state={item.status}
      data-parent={item.message.parentId}
    >
      {item.kind === "text" ? (
        <MessageContent
          content={typeof item.detail === "string" ? [] : item.detail}
        />
      ) : item.kind === "toolCall" || item.kind === "thinking" ? (
        <details
          className="work-operation"
          open={expanded}
          onToggle={(event) => {
            if (event.target === event.currentTarget)
              setExpanded(event.currentTarget.open);
          }}
        >
          <summary>
            {item.kind === "thinking" ? (
              <span className="work-thought">{item.label}</span>
            ) : (
              <>
                <strong>{item.label}</strong>
                {preview && (
                  <code className="work-target" title={preview}>
                    {preview}
                  </code>
                )}
                {(item.status === "running" ||
                  item.status === "uncertain" ||
                  item.status === "stopped") && (
                  <span className="work-operation-status">
                    {workStatus(item.status)}
                  </span>
                )}
              </>
            )}
          </summary>
          {expanded && (
            <div className="work-operation-body">
              {item.kind === "thinking" ? (
                <MessageContent
                  content={[
                    {
                      type: "text",
                      text: typeof item.detail === "string" ? item.detail : "",
                      key: item.id,
                    },
                  ]}
                />
              ) : item.result ? (
                <MessageDetail botId={botId} message={item.result}>
                  {(message) => (
                    <ToolRecord item={item} message={message} botId={botId} />
                  )}
                </MessageDetail>
              ) : (
                <ToolRecord item={item} botId={botId} />
              )}
            </div>
          )}
        </details>
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
      )}
      {time && item.kind !== "thinking" && (
        <time dateTime={time.toISOString()} title={time.toLocaleString()}>
          {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </time>
      )}
    </li>
  );
}
