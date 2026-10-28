import type { Bot } from "@domos/agent/bots";
import type { ChatView } from "@domos/agent/view";
import { PanelHeader } from "@domos/ui/panel";
import { ScrollArea } from "@domos/ui/scroll-area";
import { Tabs } from "@domos/ui/tabs";
import { type ReactNode, useState } from "react";
import type { useComputer } from "../../computer/use-computer.ts";
import { ComputerWorkspace } from "../../computer/workspace.tsx";
import { ComputerSettings } from "./computer.tsx";
import { BotIdentity, IdentityEditor } from "./identity.tsx";
import { MemoryPanel } from "./memory.tsx";
import { ModelSetup } from "./model.tsx";
import { PromptPanel } from "./prompt.tsx";
import { RootPanel } from "./root.tsx";
import { RoutinesPanel } from "./routines.tsx";
import { SkillsPanel } from "./skills.tsx";
import type { BotPanelView, PanelEditor } from "./types.ts";
import { useBotWork, useWorkAction } from "./use-bot-work.ts";
import "./style.css";

export type { BotPanelView } from "./types.ts";

const titles: Record<Exclude<BotPanelView, "root">, string> = {
  identity: "编辑资料",
  engine: "模型与账号",
  advanced: "高级设置",
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
  context,
  canManage,
  tab,
  onTabChange,
  expanded,
  onExpand,
  takeoverId,
}: {
  bot: Bot;
  active: boolean;
  view: BotPanelView;
  onViewChange: (view: BotPanelView) => void;
  onClose: () => void;
  computer: ReturnType<typeof useComputer>;
  chat: { model: ChatView["model"]; connected: boolean; busy: boolean };
  context: ReactNode;
  canManage: boolean;
  tab: "bot" | "computer" | "browser";
  onTabChange: (tab: "bot" | "computer" | "browser") => void;
  expanded: boolean;
  onExpand: () => void;
  takeoverId?: string;
}) {
  const work = useBotWork(bot.id, active && tab === "bot", view !== "root");
  const action = useWorkAction();
  const [selection, setSelection] = useState<PanelEditor | null>(null);
  const editor = selection?.view === view ? selection : null;
  const navigate = (next: BotPanelView) => {
    setSelection(null);
    onViewChange(next);
  };
  const title = view === "root" ? bot.name : titles[view];
  let content: ReactNode = null;
  if (view === "root" && active)
    content = (
      <RootPanel
        bot={bot}
        data={work.data}
        chat={chat}
        context={context}
        computer={computer}
        canManage={canManage}
        onNavigate={navigate}
      />
    );
  else if (view === "engine")
    content = <ModelSetup botId={bot.id} canManage={canManage} />;
  else if (view === "computer")
    content = <ComputerSettings computer={computer} botId={bot.id} />;
  else if (view === "memory")
    content = work.data ? (
      <MemoryPanel
        botId={bot.id}
        items={work.data.memory}
        action={action}
        editor={editor?.view === "memory" ? editor : null}
        onEditorChange={setSelection}
      />
    ) : (
      <p role="status">正在读取记忆…</p>
    );
  else if (view === "skills")
    content = work.data ? (
      <SkillsPanel
        botId={bot.id}
        items={work.data.skills}
        action={action}
        editor={editor?.view === "skills" ? editor : null}
        onEditorChange={setSelection}
      />
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
        editor={editor?.view === "routines" ? editor : null}
        onEditorChange={setSelection}
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
      data-computer={(view === "root" && tab !== "bot") || undefined}
      aria-label={`${bot.name}的详情`}
    >
      <PanelHeader
        title={title}
        onBack={
          view === "root"
            ? undefined
            : () => (editor ? setSelection(null) : navigate("root"))
        }
        onClose={onClose}
      />
      {view === "root" && (
        <div className="detail-identity">
          <BotIdentity
            bot={bot}
            profile={work.profile}
            onEdit={() => navigate("identity")}
          />
          <Tabs.Root
            className="bot-tabs"
            value={tab}
            onValueChange={(value) =>
              onTabChange(value as "bot" | "computer" | "browser")
            }
          >
            <Tabs.List className="workspace-tabs" aria-label="Bot详情">
              <Tabs.Tab className="workspace-tab" value="bot">
                Bot
              </Tabs.Tab>
              <Tabs.Tab className="workspace-tab" value="computer">
                Computer
              </Tabs.Tab>
              <Tabs.Tab className="workspace-tab" value="browser">
                Browser
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.Root>
        </div>
      )}
      {view === "root" && tab !== "bot" && active && (
        <ComputerWorkspace
          takeoverId={takeoverId}
          key={tab}
          bot={bot}
          computer={computer}
          admin={canManage}
          service={tab === "browser" ? "browser" : "desktop"}
          expanded={expanded}
          onExpand={onExpand}
          onSettings={() => navigate("computer")}
        />
      )}
      <ScrollArea
        hidden={view === "root" && tab !== "bot"}
        className="detail-scroll"
        viewportClassName="detail-content"
      >
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
        {view !== "identity" && (view !== "root" || tab === "bot") && (
          <div
            className="detail-view"
            key={`${view}:${editor ? "editor" : "list"}`}
          >
            {content}
          </div>
        )}
      </ScrollArea>
    </aside>
  );
}
