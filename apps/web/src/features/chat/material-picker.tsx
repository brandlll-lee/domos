import type { InputMaterials } from "@domos/agent/materials";
import { type ChatMessage, messageText } from "@domos/agent/messages";
import { WORK_TEXT_LENGTH } from "@domos/agent/work/limits";
import { Button } from "@domos/ui/controls";
import { Loading } from "@domos/ui/loading";
import { Tooltip } from "@domos/ui/popover";
import { ChatCircleIcon } from "@phosphor-icons/react/dist/csr/ChatCircle";
import { FolderSimpleIcon } from "@phosphor-icons/react/dist/csr/FolderSimple";
import { HammerIcon } from "@phosphor-icons/react/dist/csr/Hammer";
import { type ReactNode, useId, useState } from "react";
import {
  managedConnections,
  nativeConnections,
} from "../apps/connection-state.ts";
import { nativeMcpNotice, nativeMcpStatus } from "../apps/copy.ts";
import { useBotWork } from "../bots/details/use-bot-work.ts";
import { useReadState } from "../read-state.ts";
import { userError } from "../user-error.ts";

function focusChoice(element: HTMLElement | null) {
  if (document.activeElement?.matches(".composer-menu-popup"))
    (element instanceof HTMLButtonElement
      ? element
      : element?.querySelector<HTMLButtonElement>("button:not(:disabled)")
    )?.focus();
}

function MaterialChoice({
  name,
  icon,
  detail,
  disabled,
  onClick,
}: {
  name: string;
  icon: ReactNode;
  detail: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  const detailId = useId();
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        ref={focusChoice}
        render={<button type="button" disabled={disabled} />}
        className="composer-picker-row"
        aria-label={name}
        aria-describedby={detailId}
        onClick={onClick}
      >
        {icon}
        <span>{name}</span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner
          className="tooltip-positioner composer-detail-positioner"
          side="right"
          align="center"
          sideOffset={8}
          collisionPadding={12}
        >
          <Tooltip.Popup
            id={detailId}
            role="tooltip"
            className="tooltip-surface composer-detail"
          >
            {detail}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function SkillPicker({
  botId,
  onSelect,
}: {
  botId: number;
  onSelect: (skill: InputMaterials["skills"][number]) => void;
}) {
  const { data, error, retry } = useBotWork(botId, true, true, false);
  const notice =
    data?.nativeSkillsNotice ??
    (data && data.nativeSkills === undefined
      ? "当前尚无原生技能目录。"
      : undefined);
  const skills = data && [
    ...(data.nativeSkills ?? []).map((skill) => ({
      id: skill.path ?? skill.name,
      name: skill.name,
      description: skill.description,
      path: skill.path,
      content: undefined,
      revision: undefined,
      origin: `${data.nativeSkillsProvider ?? "原生"} · ${skill.source} · ${skill.path ? "只读" : "未提供读取路径"}`,
      ...(skill.path && data.nativeSkillsProvider
        ? {
            native: {
              ...skill,
              path: skill.path,
              provider: data.nativeSkillsProvider,
            },
          }
        : {}),
    })),
    ...data.skills
      .filter(
        (skill) =>
          skill.enabledBots.includes(botId) &&
          !data.nativeSkills?.some((native) => native.name === skill.name),
      )
      .map((skill) => ({
        ...skill,
        origin: "Domos",
        path: undefined,
        native: undefined,
      })),
  ];
  return (
    <>
      {notice && (
        <p className="composer-picker-state" role="status">
          {notice}
        </p>
      )}
      {error ? (
        <div className="composer-picker-state" role="alert">
          {error}
          <Button variant="ghost" size="small" onClick={retry}>
            重试
          </Button>
        </div>
      ) : null}
      {!skills && !error ? (
        <Loading label="正在读取技能" />
      ) : !skills ? null : !skills.length ? (
        <p className="composer-picker-state">暂无已启用的技能</p>
      ) : (
        <div className="composer-picker-list" ref={focusChoice}>
          {skills.map((skill) => (
            <MaterialChoice
              key={skill.id}
              name={skill.name}
              icon={<FolderSimpleIcon weight="light" />}
              detail={
                <>
                  {skill.description && <p>{skill.description}</p>}
                  <p>{skill.origin}</p>
                  {skill.path && <p>{skill.path}</p>}
                </>
              }
              disabled={!skill.content && !skill.native}
              onClick={() =>
                onSelect({
                  id: skill.id,
                  revision: skill.revision,
                  name: skill.name,
                  content: skill.content,
                  ...(skill.native ? { native: skill.native } : {}),
                })
              }
            />
          ))}
        </div>
      )}
    </>
  );
}

export function TextPicker({
  botId,
  onSelect,
}: {
  botId: number;
  onSelect: (context: InputMaterials["context"][number]) => void;
}) {
  const [text, setText] = useState("");
  return (
    <div className="composer-text-picker">
      <textarea
        className="field-control"
        aria-label="引用文本"
        placeholder="粘贴要引用的内容…"
        maxLength={WORK_TEXT_LENGTH}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <Button
        size="small"
        disabled={!text.trim()}
        onClick={() =>
          onSelect({
            id: crypto.randomUUID(),
            type: "text",
            botId,
            text: text.trim(),
          })
        }
      >
        添加
      </Button>
    </div>
  );
}

export function MessagePicker({
  botId,
  messages,
  onSelect,
}: {
  botId: number;
  messages: ChatMessage[];
  onSelect: (context: InputMaterials["context"][number]) => void;
}) {
  const choices = messages
    .filter(
      (message) =>
        (message.role === "user" || message.role === "assistant") &&
        !message.pending &&
        messageText(message).trim() &&
        messageText(message).length <= WORK_TEXT_LENGTH,
    )
    .toReversed();
  return (
    <div className="composer-picker-list" ref={focusChoice}>
      {choices.length ? (
        choices.map((message) => (
          <button
            className="composer-picker-row composer-message-choice"
            type="button"
            key={message.id}
            title={messageText(message)}
            onClick={() =>
              onSelect({
                id: crypto.randomUUID(),
                type: "message",
                botId,
                messageId: message.id,
                text: messageText(message),
                role: message.role as "user" | "assistant",
                ...(message.timestamp ? { timestamp: message.timestamp } : {}),
              })
            }
          >
            <ChatCircleIcon weight="light" />
            <span>{messageText(message)}</span>
          </button>
        ))
      ) : (
        <p className="composer-picker-state">没有可引用的消息</p>
      )}
    </div>
  );
}

export function McpPicker({
  botId,
  onSelect,
}: {
  botId: number;
  onSelect: (item: NonNullable<InputMaterials["mcp"]>[number]) => void;
}) {
  const managed = useReadState(managedConnections);
  const native = useReadState(nativeConnections(botId));
  const catalog = native.data;
  const items: NonNullable<InputMaterials["mcp"]> = [
    ...(managed.data ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      available:
        item.enabled && item.grants.some((grant) => grant.botId === botId),
      status: item.status ?? "configured",
    })),
    ...(catalog
      ? catalog.items.map((item) => ({
          id: item.name,
          name: item.name,
          native: { provider: catalog.provider, source: item.source },
          available: item.enabled === true && catalog.inherited,
          status: nativeMcpStatus(item),
        }))
      : []),
  ];
  const errors = [
    catalog ? nativeMcpNotice(catalog) : "",
    managed.error
      ? `Domos MCP：${userError(managed.error, "目录读取失败。")}`
      : "",
    native.error
      ? `原生 MCP：${userError(native.error, "目录读取失败。")}`
      : "",
  ].filter(Boolean);
  const loading =
    managed.loading ||
    native.loading ||
    (!managed.data && !managed.error) ||
    (!native.data && !native.error);
  return (
    <>
      {catalog && (
        <p className="composer-picker-state">
          {catalog.scope === "session"
            ? "当前私聊会话"
            : "工作目录配置；不代表本轮已连接"}
        </p>
      )}
      {errors.map((error) => (
        <p key={error} className="composer-picker-state" role="status">
          {error}
        </p>
      ))}
      <div className="composer-picker-list" ref={focusChoice}>
        {items.map((item) => (
          <MaterialChoice
            key={`${item.native?.source ?? "domos"}:${item.id}`}
            name={item.name}
            icon={<HammerIcon weight="light" />}
            onClick={() => onSelect(item)}
            detail={
              <p>
                {item.native
                  ? `${item.native.provider} · ${item.native.source} · ${catalog?.inherited ? "沿用原生配置" : "未沿用"}`
                  : `Domos · ${item.available ? "已授权" : "未授权或已停用"}`}{" "}
                · {item.status}
              </p>
            }
          />
        ))}
        {!loading &&
          !errors.length &&
          catalog?.status === "complete" &&
          !items.length && (
            <p className="composer-picker-state">暂无 MCP 连接</p>
          )}
      </div>
      {loading && <Loading label="正在读取 MCP" inline={items.length > 0} />}
      <Button
        variant="ghost"
        disabled={native.loading}
        onClick={() =>
          void nativeConnections(botId)
            .load(true)
            .catch(() => {})
        }
      >
        刷新原生连接
      </Button>
    </>
  );
}
