import type { PrivateConversation } from "@domos/agent/conversations";
import type { InputMaterials } from "@domos/agent/materials";
import { Button } from "@domos/ui/controls";
import { SearchField } from "@domos/ui/field";
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
import { contactTime } from "./format.ts";

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

export function ConversationPicker({
  botId,
  conversations,
  onSelect,
}: {
  botId: number;
  conversations: PrivateConversation[];
  onSelect: (context: InputMaterials["context"][number]) => void;
}) {
  const [query, setQuery] = useState("");
  const choices = conversations.filter((item) =>
    item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <>
      <SearchField
        aria-label="搜索会话"
        placeholder="搜索会话"
        value={query}
        onValueChange={setQuery}
      />
      <div className="composer-picker-list" ref={focusChoice}>
        {choices.length ? (
          choices.map((item) => (
            <button
              type="button"
              className="composer-picker-row"
              key={item.id}
              onClick={() =>
                onSelect({
                  id: crypto.randomUUID(),
                  type: "conversation",
                  conversationId: item.id,
                  botId,
                  text: item.title,
                })
              }
            >
              <ChatCircleIcon weight="light" />
              <span>{item.title}</span>
              {item.updatedAt && (
                <time>{contactTime(item.updatedAt, Date.now())}</time>
              )}
            </button>
          ))
        ) : (
          <p className="composer-picker-state">没有匹配的会话</p>
        )}
      </div>
    </>
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
