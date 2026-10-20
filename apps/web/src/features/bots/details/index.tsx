import type { Bot } from "@domos/agent/bots";
import type { ChatView } from "@domos/agent/view";
import { Button } from "@domos/ui/controls";
import { ScrollArea } from "@domos/ui/scroll-area";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type { ReactNode } from "react";
import type { useComputer } from "../../computer/use-computer.ts";
import { ComputerSettings } from "./computer.tsx";
import { EngineSettings } from "./engine-settings.tsx";
import { IdentityEditor } from "./identity.tsx";
import { MemoryPanel } from "./memory.tsx";
import { PromptPanel } from "./prompt.tsx";
import { RootPanel } from "./root.tsx";
import { RoutinesPanel } from "./routines.tsx";
import { SkillsPanel } from "./skills.tsx";
import type { BotPanelView } from "./types.ts";
import { useBotWork, useWorkAction } from "./use-bot-work.ts";
import { useEngine } from "./use-engine.ts";
import "./style.css";

export type { BotPanelView } from "./types.ts";

const titles: Record<Exclude<BotPanelView, "root">, string> = {
  identity: "编辑资料",
  engine: "任务引擎",
  computer: "工作电脑",
  memory: "记忆",
  skills: "技能",
  routines: "定时",
  prompt: "提示词",
};

export function BotDetails({
  bot,
  active,
  view,
  onViewChange,
  onClose,
  computer,
  chat,
  canManage,
}: {
  bot: Bot;
  active: boolean;
  view: BotPanelView;
  onViewChange: (view: BotPanelView) => void;
  onClose: () => void;
  computer: ReturnType<typeof useComputer>;
  chat: { model: ChatView["model"]; connected: boolean; busy: boolean };
  canManage: boolean;
}) {
  const work = useBotWork(bot.id, active);
  const engine = useEngine(bot.id, active, chat.busy);
  const action = useWorkAction();
  const title = view === "root" ? bot.name : titles[view];
  let content: ReactNode = null;
  if (view === "root")
    content = (
      <RootPanel
        bot={bot}
        profile={work.profile}
        data={work.data}
        engine={engine}
        model={chat.model}
        computer={computer}
        onNavigate={onViewChange}
      />
    );
  else if (view === "engine")
    content = (
      <EngineSettings
        botId={bot.id}
        setup={engine}
        canManage={canManage}
        model={chat.model}
        connected={chat.connected}
      />
    );
  else if (view === "computer")
    content = <ComputerSettings computer={computer} botId={bot.id} />;
  else if (view === "memory")
    content = work.data ? (
      <MemoryPanel botId={bot.id} items={work.data.memory} action={action} />
    ) : (
      <p role="status">正在读取记忆…</p>
    );
  else if (view === "skills")
    content = work.data ? (
      <SkillsPanel botId={bot.id} items={work.data.skills} action={action} />
    ) : (
      <p role="status">正在读取技能…</p>
    );
  else if (view === "routines")
    content = work.data ? (
      <RoutinesPanel
        botId={bot.id}
        data={work.data.routines}
        skills={work.data.skills}
        action={action}
      />
    ) : (
      <p role="status">正在读取定时任务…</p>
    );
  else if (view === "prompt")
    content = <PromptPanel botId={bot.id} action={action} />;
  return (
    <aside
      tabIndex={-1}
      id="bot-details"
      className="bot-details"
      aria-label={`${bot.name}的详情`}
    >
      <header className="detail-header">
        {view !== "root" && (
          <Button
            variant="ghost"
            size="icon-small"
            aria-label="返回"
            onClick={() => onViewChange("root")}
          >
            <ArrowLeftIcon />
          </Button>
        )}
        <h2 className="detail-title">{title}</h2>
        <Button
          variant="ghost"
          size="icon-small"
          className="detail-close"
          aria-label="关闭"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </header>
      <ScrollArea className="detail-scroll" viewportClassName="detail-content">
        {!work.connected && view !== "root" && (
          <p className="detail-note" role="status">
            正在连接详情…
          </p>
        )}
        {(work.error || action.error) && (
          <p className="alert" role="alert">
            {action.error ?? work.error}
          </p>
        )}
        {view === "identity" && !work.profile && (
          <p role="status">正在读取资料…</p>
        )}
        {work.profile && (
          <div hidden={view !== "identity"}>
            <IdentityEditor
              key={work.profile.revision}
              profile={work.profile}
              action={action}
              onSaved={work.setProfile}
            />
          </div>
        )}
        {view !== "identity" && content}
      </ScrollArea>
    </aside>
  );
}
