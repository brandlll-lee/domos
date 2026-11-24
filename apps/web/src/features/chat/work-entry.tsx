import type { ChatMessage } from "@domos/agent/messages";
import { Disclosure } from "@domos/ui/disclosure";
import { BrainIcon } from "@phosphor-icons/react/dist/csr/Brain";
import { ChatTextIcon } from "@phosphor-icons/react/dist/csr/ChatText";
import { FileTextIcon } from "@phosphor-icons/react/dist/csr/FileText";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { ListChecksIcon } from "@phosphor-icons/react/dist/csr/ListChecks";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { TerminalIcon } from "@phosphor-icons/react/dist/csr/Terminal";
import { UsersIcon } from "@phosphor-icons/react/dist/csr/Users";
import { WrenchIcon } from "@phosphor-icons/react/dist/csr/Wrench";
import { useState } from "react";
import { Attachments } from "./attachments.tsx";
import { MessageContent } from "./message-content.tsx";
import { MessageDetail } from "./message-detail.tsx";
import { type WorkItem, workStatus, workTime } from "./work-state.ts";

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

export function WorkEntry({ item, botId }: { item: WorkItem; botId: number }) {
  const [expanded, setExpanded] = useState(false);
  const event = item.message.activity;
  const input = item.input ?? {};
  const native = item.result?.native;
  const Icon =
    item.kind === "thinking"
      ? BrainIcon
      : item.kind === "text"
        ? ChatTextIcon
        : item.kind === "event"
          ? event?.type === "plan"
            ? ListChecksIcon
            : InfoIcon
          : input.command || native?.command
            ? TerminalIcon
            : input.query || native?.type === "webSearch"
              ? MagnifyingGlassIcon
              : input.file_path || input.path || native?.type === "fileChange"
                ? FileTextIcon
                : native?.type === "collabAgentToolCall"
                  ? UsersIcon
                  : WrenchIcon;
  const preview =
    text(
      input.description ??
        input.command ??
        input.file_path ??
        input.path ??
        input.query,
    ) ||
    (typeof item.detail === "string"
      ? item.detail
      : item.detail
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join(" "));
  const duration = native?.durationMs;
  const time =
    typeof duration === "number" && Number.isFinite(duration) && duration >= 0
      ? workTime(0, duration)
      : workTime(item.startedAt, item.endedAt);
  return (
    <li
      className="work-entry"
      data-state={item.status}
      data-parent={item.message.parentId}
      tabIndex={-1}
    >
      <span
        className="work-node"
        role="img"
        aria-label={item.kind === "toolCall" ? "工具调用" : item.label}
      >
        <Icon />
      </span>
      <Disclosure
        className="work-operation"
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
        label={
          <>
            <span className="work-step-copy">
              <strong>{item.label}</strong>
              {preview && (
                <span className="work-preview">{preview.slice(0, 240)}</span>
              )}
              {["running", "uncertain", "stopped", "failed"].includes(
                item.status,
              ) && (
                <span className="work-operation-status">
                  {workStatus(item.status)}
                </span>
              )}
            </span>
            <span className="work-step-time">
              {time === "—" ? "耗时未知" : time}
            </span>
          </>
        }
      >
        {expanded && (
          <div className="work-operation-body">
            {item.kind === "text" ? (
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
            )}
          </div>
        )}
      </Disclosure>
    </li>
  );
}
