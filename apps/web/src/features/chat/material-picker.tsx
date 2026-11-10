import type { InputMaterials } from "@domos/agent/materials";
import { type ChatMessage, messageText } from "@domos/agent/messages";
import { WORK_TEXT_LENGTH } from "@domos/agent/work/limits";
import { Button } from "@domos/ui/controls";
import { Loading } from "@domos/ui/loading";
import { Tooltip } from "@domos/ui/popover";
import { ChatCircleIcon } from "@phosphor-icons/react/dist/csr/ChatCircle";
import { FolderSimpleIcon } from "@phosphor-icons/react/dist/csr/FolderSimple";
import { HammerIcon } from "@phosphor-icons/react/dist/csr/Hammer";
import { type ReactNode, useEffect, useId, useState } from "react";
import { client } from "../../client.ts";
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
          className="composer-detail-positioner"
          side="right"
          align="center"
          sideOffset={8}
          collisionPadding={12}
        >
          <Tooltip.Popup
            id={detailId}
            role="tooltip"
            className="composer-detail"
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
  const [skills, setSkills] = useState<
    | (InputMaterials["skills"][number] & {
        origin: string;
        description?: string;
        path?: string;
      })[]
    | null
  >(null);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (error) return;
    const controller = new AbortController();
    void client.work
      .get({ botId }, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setNotice(
            data.nativeSkillsNotice ??
              (data.nativeSkills === undefined
                ? "当前尚无原生技能目录。"
                : undefined),
          );
          setSkills([
            ...(data.nativeSkills ?? []).map((skill) => ({
              id: skill.path ?? skill.name,
              name: skill.name,
              description: skill.description,
              path: skill.path,
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
                  !data.nativeSkills?.some(
                    (native) => native.name === skill.name,
                  ),
              )
              .map((skill) => ({ ...skill, origin: "Domos" })),
          ]);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(userError(cause, "技能加载失败。"));
      });
    return () => controller.abort();
  }, [botId, error]);
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
          <Button
            variant="ghost"
            size="small"
            onClick={() => {
              setError(null);
            }}
          >
            重试
          </Button>
        </div>
      ) : !skills ? (
        <Loading label="正在读取技能" />
      ) : !skills.length ? (
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
  const [catalog, setCatalog] = useState<{
    managed?: InputMaterials["mcp"];
    native?: InputMaterials["mcp"];
  }>({});
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    const reads = {
      managed: client.mcp
        .list(undefined, { signal: controller.signal })
        .then((items) =>
          items.map((item) => ({
            id: item.id,
            name: item.name,
            available:
              item.enabled &&
              item.grants.some((grant) => grant.botId === botId),
            status: item.status ?? "configured",
          })),
        ),
      native: client.mcp
        .native({ botId }, { signal: controller.signal })
        .then((catalog) =>
          catalog.items.map((item) => ({
            id: item.name,
            name: item.name,
            native: { provider: catalog.provider, source: item.source },
            available: item.enabled && catalog.inherited,
            status: item.status,
          })),
        ),
    };
    for (const [source, request] of Object.entries(reads)) {
      void request
        .then((items) => {
          if (!controller.signal.aborted)
            setCatalog((current) => ({ ...current, [source]: items }));
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          setCatalog((current) => ({ ...current, [source]: [] }));
          setErrors((current) => [
            ...current,
            `${source === "native" ? "原生 MCP" : "Domos MCP"}：${userError(error, "目录读取失败。恢复连接后可重新打开。")}`,
          ]);
        });
    }
    return () => controller.abort();
  }, [botId]);
  const items = [...(catalog.managed ?? []), ...(catalog.native ?? [])];
  const loading = catalog.managed === undefined || catalog.native === undefined;
  return (
    <>
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
                  ? `${item.native.provider} · ${item.native.source} · ${item.available ? "沿用原生配置" : "未沿用"}`
                  : `Domos · ${item.available ? "已授权" : "未授权或已停用"}`}{" "}
                · {item.status}
              </p>
            }
          />
        ))}
        {!loading && !items.length && (
          <p className="composer-picker-state">暂无 MCP 连接</p>
        )}
      </div>
      {loading && <Loading label="正在读取 MCP" />}
    </>
  );
}
