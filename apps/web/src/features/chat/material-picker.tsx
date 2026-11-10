import type { InputMaterials } from "@domos/agent/materials";
import { type ChatMessage, messageText } from "@domos/agent/messages";
import { WORK_TEXT_LENGTH } from "@domos/agent/work/limits";
import { Button } from "@domos/ui/controls";
import { SearchField } from "@domos/ui/field";
import { Loading } from "@domos/ui/loading";
import { useEffect, useState } from "react";
import { client } from "../../client.ts";
import { userError } from "../user-error.ts";

export function SkillPicker({
  botId,
  onSelect,
}: {
  botId: number;
  onSelect: (skill: InputMaterials["skills"][number]) => void;
}) {
  const [skills, setSkills] = useState<
    (InputMaterials["skills"][number] & { origin: string })[] | null
  >(null);
  const [search, setSearch] = useState("");
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
  const filtered = skills?.filter((skill) =>
    skill.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <>
      <SearchField
        className="composer-picker-search"
        aria-label="搜索技能"
        placeholder="搜索技能…"
        value={search}
        onValueChange={setSearch}
      />
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
      ) : !filtered?.length ? (
        <p className="composer-picker-state">
          {search ? "没有匹配的技能" : "暂无已启用的技能"}
        </p>
      ) : (
        <div className="composer-picker-list">
          {filtered.map((skill) => (
            <button
              className="composer-picker-row"
              type="button"
              key={skill.id}
              aria-label={skill.name}
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
            >
              <span>{skill.name}</span>
              <small>{skill.origin}</small>
            </button>
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
  const [search, setSearch] = useState("");
  const choices = messages
    .filter(
      (message) =>
        (message.role === "user" || message.role === "assistant") &&
        !message.pending &&
        messageText(message).trim() &&
        messageText(message).length <= WORK_TEXT_LENGTH &&
        messageText(message)
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()),
    )
    .toReversed();
  return (
    <>
      <SearchField
        className="composer-picker-search"
        aria-label="搜索消息"
        placeholder="搜索消息…"
        value={search}
        onValueChange={setSearch}
      />
      <div className="composer-picker-list">
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
                  ...(message.timestamp
                    ? { timestamp: message.timestamp }
                    : {}),
                })
              }
            >
              {messageText(message)}
            </button>
          ))
        ) : (
          <p className="composer-picker-state">没有可引用的消息</p>
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
  const [catalog, setCatalog] = useState<{
    managed?: InputMaterials["mcp"];
    native?: InputMaterials["mcp"];
  }>({});
  const [search, setSearch] = useState("");
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
  const filtered = items.filter((item) =>
    item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <>
      <SearchField
        className="composer-picker-search"
        aria-label="搜索 MCP"
        placeholder="搜索 MCP…"
        value={search}
        onValueChange={setSearch}
      />
      {errors.map((error) => (
        <p key={error} className="composer-picker-state" role="status">
          {error}
        </p>
      ))}
      <div className="composer-picker-list">
        {filtered.map((item) => (
          <button
            type="button"
            className="composer-picker-row"
            key={`${item.native?.source ?? "domos"}:${item.id}`}
            onClick={() => onSelect(item)}
          >
            <span>{item.name}</span>
            <small>
              {item.native
                ? `${item.native.provider} · ${item.native.source} · ${item.available ? "沿用原生配置" : "未沿用"}`
                : `Domos · ${item.available ? "已授权" : "未授权或已停用"}`}{" "}
              · {item.status}
            </small>
          </button>
        ))}
        {!loading && !filtered.length && (
          <p className="composer-picker-state">
            {search ? "没有匹配的 MCP" : "暂无 MCP 连接"}
          </p>
        )}
      </div>
      {loading && <Loading label="正在读取 MCP" />}
    </>
  );
}
