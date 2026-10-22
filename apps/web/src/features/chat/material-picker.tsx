import type { InputMaterials } from "@domos/agent/materials";
import { type ChatMessage, messageText } from "@domos/agent/messages";
import { WORK_TEXT_LENGTH } from "@domos/agent/work/limits";
import { Button } from "@domos/ui/controls";
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
  const [skills, setSkills] = useState<InputMaterials["skills"] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (error) return;
    const controller = new AbortController();
    void client.work
      .get({ botId }, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted)
          setSkills(
            data.skills.filter((skill) => skill.enabledBots.includes(botId)),
          );
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
      <input
        className="composer-picker-search"
        aria-label="搜索技能"
        placeholder="搜索技能…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
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
        <p className="composer-picker-state" role="status">
          正在加载…
        </p>
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
              onClick={() =>
                onSelect({
                  id: skill.id,
                  revision: skill.revision,
                  name: skill.name,
                  content: skill.content,
                })
              }
            >
              {skill.name}
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
      <input
        className="composer-picker-search"
        aria-label="搜索消息"
        placeholder="搜索消息…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
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
