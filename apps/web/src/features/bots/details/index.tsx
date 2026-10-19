import type { Bot } from "@domos/agent/bots";
import { Button } from "@domos/ui/controls";
import { ScrollArea } from "@domos/ui/scroll-area";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type { ReactNode } from "react";
import { MemoryPanel } from "./memory.tsx";
import { ProfileEditor } from "./profile.tsx";
import { PromptPanel } from "./prompt.tsx";
import { RoutinesPanel } from "./routines.tsx";
import { SkillsPanel } from "./skills.tsx";
import { useBotWork, useWorkAction } from "./use-bot-work.ts";
import "./style.css";

export type BotPanel =
  | "profile"
  | "computer"
  | "memory"
  | "skills"
  | "routines"
  | "prompt";

export function BotDetails({
  bot,
  active,
  onClose,
  computer,
  model,
  panel,
  onPanelChange,
}: {
  bot: Bot;
  active: boolean;
  panel: BotPanel;
  onPanelChange: (panel: BotPanel) => void;
  onClose: () => void;
  computer: ReactNode;
  model: ReactNode;
}) {
  const work = useBotWork(bot.id, active);
  const action = useWorkAction();
  const panels = {
    profile: {
      label: "Bot设置",
      content: work.profile && (
        <ProfileEditor
          key={work.profile.revision}
          profile={work.profile}
          action={action}
          onSaved={work.setProfile}
        />
      ),
    },
    computer: { label: "电脑", content: computer },
    memory: {
      label: "记忆",
      content: work.data && (
        <MemoryPanel botId={bot.id} items={work.data.memory} action={action} />
      ),
    },
    skills: {
      label: "技能",
      content: work.data && (
        <SkillsPanel botId={bot.id} items={work.data.skills} action={action} />
      ),
    },
    routines: {
      label: "定时",
      content: work.data && (
        <RoutinesPanel
          botId={bot.id}
          data={work.data.routines}
          skills={work.data.skills}
          action={action}
        />
      ),
    },
    prompt: {
      label: "提示词",
      content: <PromptPanel botId={bot.id} action={action} />,
    },
  };
  return (
    <aside
      tabIndex={-1}
      id="bot-details"
      className="bot-details"
      aria-label={`${bot.name}的详情`}
    >
      <header className="detail-header">
        <strong>{panel === "computer" ? "工作环境" : bot.name}</strong>
        {panel === "computer" && (
          <Button
            variant="ghost"
            size="small"
            onClick={() => onPanelChange("profile")}
          >
            Bot设置
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-small"
          aria-label="关闭"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </header>
      {panel !== "computer" && (
        <nav className="detail-nav" aria-label="Bot设置分区">
          <Button
            variant="ghost"
            aria-pressed={panel === "profile"}
            onClick={() => onPanelChange("profile")}
          >
            Bot设置
          </Button>
          <Button
            variant="ghost"
            aria-pressed={panel !== "profile"}
            onClick={() => onPanelChange("memory")}
          >
            工作配置
          </Button>
        </nav>
      )}
      {panel !== "profile" && panel !== "computer" && (
        <nav className="detail-nav" aria-label="工作配置">
          {(["memory", "skills", "routines", "prompt"] as const).map((key) => (
            <Button
              key={key}
              variant="ghost"
              aria-pressed={panel === key}
              onClick={() => onPanelChange(key)}
            >
              {panels[key].label}
            </Button>
          ))}
        </nav>
      )}
      <ScrollArea className="detail-scroll" viewportClassName="detail-content">
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
        {Object.entries(panels).map(([key, item]) => (
          <section key={key} hidden={panel !== key} aria-label={item.label}>
            <fieldset
              className="bot-fields"
              disabled={!work.connected || action.busy}
            >
              {item.content}
              {key === "profile" && model}
            </fieldset>
          </section>
        ))}
      </ScrollArea>
    </aside>
  );
}
