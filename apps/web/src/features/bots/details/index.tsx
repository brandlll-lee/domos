import type { Bot } from "@domos/agent/bots";
import { Button } from "@domos/ui/controls";
import { ScrollArea } from "@domos/ui/scroll-area";
import { Tabs } from "@domos/ui/tabs";
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
    <Tabs.Root
      render={<aside />}
      value={panel}
      onValueChange={(value) => onPanelChange(value as BotPanel)}
      tabIndex={-1}
      id="bot-details"
      className="bot-details"
      aria-label={`${bot.name}的详情`}
    >
      <header className="detail-header">
        <strong>{bot.name}</strong>
        <Button
          variant="ghost"
          size="icon-small"
          aria-label="关闭"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </header>
      <Tabs.List className="detail-nav" aria-label="Bot设置分区">
        {Object.entries(panels).map(([key, item]) => (
          <Tabs.Tab key={key} value={key}>
            {item.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
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
          <Tabs.Panel key={key} value={key} keepMounted aria-label={item.label}>
            <fieldset
              className="bot-fields"
              disabled={!work.connected || action.busy}
            >
              {item.content}
              {key === "profile" && model}
            </fieldset>
          </Tabs.Panel>
        ))}
      </ScrollArea>
    </Tabs.Root>
  );
}
