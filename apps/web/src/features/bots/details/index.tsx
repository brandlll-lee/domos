import type { Bot } from "@domos/agent/bots";
import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { useEffect, useState } from "react";
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

export function BotDetails({ bot }: { bot: Bot }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) setOpen(value);
      }}
      title={`${bot.name}的详情`}
      description="管理长期身份、记忆、共享技能与定时工作。"
      trigger={
        <Button variant="ghost" aria-label="Bot详情">
          详情
        </Button>
      }
    >
      {open && (
        <Details
          bot={bot}
          onClose={() => setOpen(false)}
          onBusyChange={setBusy}
        />
      )}
    </Dialog>
  );
}

function Details({
  bot,
  onClose,
  onBusyChange,
}: {
  bot: Bot;
  onClose: () => void;
  onBusyChange: (value: boolean) => void;
}) {
  const work = useBotWork(bot.id);
  const action = useWorkAction();
  const [panel, setPanel] = useState<Panel>("profile");
  useEffect(() => onBusyChange(action.busy), [action.busy, onBusyChange]);
  return (
    <div className="bot-details">
      <nav className="detail-actions" aria-label="Bot设置分区">
        {Object.entries(panels).map(([key, label]) => (
          <Button
            key={key}
            variant={panel === key ? "secondary" : "ghost"}
            aria-pressed={panel === key}
            disabled={action.busy}
            onClick={() => setPanel(key as Panel)}
          >
            {label}
          </Button>
        ))}
      </nav>
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
      <div className="dialog-actions">
        <Button variant="ghost" disabled={action.busy} onClick={onClose}>
          关闭
        </Button>
      </div>
    </div>
  );
}
