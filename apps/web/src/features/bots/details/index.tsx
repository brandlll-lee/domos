import type { Bot } from "@domos/agent/bots";
import { Button } from "@domos/ui/controls";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useEffect, useRef, useState } from "react";
import { MemoryPanel } from "./memory.tsx";
import { ProfileEditor } from "./profile.tsx";
import { PromptPanel } from "./prompt.tsx";
import { RoutinesPanel } from "./routines.tsx";
import { SkillsPanel } from "./skills.tsx";
import { useBotWork, useWorkAction } from "./use-bot-work.ts";
import "./style.css";

const panels = {
  profile: "身份",
  memory: "记忆",
  skills: "技能",
  routines: "定时",
  prompt: "提示词",
};
type Panel = keyof typeof panels;

export function BotDetails({
  bot,
  onClose,
}: {
  bot: Bot;
  onClose: () => void;
}) {
  const work = useBotWork(bot.id);
  const action = useWorkAction();
  const [panel, setPanel] = useState<Panel>("profile");
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    root.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  return (
    <aside
      id="bot-details"
      className="bot-details"
      aria-label={`${bot.name}的详情`}
      ref={root}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !action.busy && !event.defaultPrevented) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="detail-header">
        <h2>{bot.name}</h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="关闭"
          disabled={action.busy}
          onClick={onClose}
        >
          <XIcon size={18} aria-hidden="true" />
        </Button>
      </header>
      <nav className="detail-nav" aria-label="Bot设置分区">
        {Object.entries(panels).map(([key, label]) => (
          <button
            type="button"
            key={key}
            aria-pressed={panel === key}
            disabled={action.busy}
            onClick={() => setPanel(key as Panel)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="detail-content" key={panel}>
        {!work.connected && (
          <p className="detail-note" role="status">
            正在连接详情…
          </p>
        )}
        {(work.error || action.error) && (
          <p className="alert" role="alert">
            {action.error ?? work.error}
          </p>
        )}
        <fieldset
          className="bot-fields"
          disabled={!work.connected || action.busy}
        >
          {panel === "profile" && work.profile && (
            <ProfileEditor
              key={work.profile.revision}
              profile={work.profile}
              action={action}
              onSaved={work.setProfile}
            />
          )}
          {panel === "memory" && work.data && (
            <MemoryPanel
              botId={bot.id}
              items={work.data.memory}
              action={action}
            />
          )}
          {panel === "skills" && work.data && (
            <SkillsPanel
              botId={bot.id}
              items={work.data.skills}
              action={action}
            />
          )}
          {panel === "routines" && work.data && (
            <RoutinesPanel
              botId={bot.id}
              data={work.data.routines}
              skills={work.data.skills}
              action={action}
            />
          )}
          {panel === "prompt" && <PromptPanel botId={bot.id} action={action} />}
        </fieldset>
      </div>
    </aside>
  );
}
