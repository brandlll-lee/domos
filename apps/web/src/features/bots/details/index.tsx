import type { Bot } from "@domos/agent/bots";
import type { ChatView } from "@domos/agent/view";
import { Button } from "@domos/ui/controls";
import { Loading } from "@domos/ui/loading";
import { PanelHeader } from "@domos/ui/panel";
import { ScrollArea } from "@domos/ui/scroll-area";
import { Tabs } from "@domos/ui/tabs";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { openChatTarget } from "../../chat/attention.tsx";
import type { MessageTarget } from "../../chat/message-target.ts";
import { useChat } from "../../chat/use-chat.ts";
import { WorkPanel } from "../../chat/work.tsx";
import type { useComputer } from "../../computer/use-computer.ts";
import { ComputerWorkspace } from "../../computer/workspace.tsx";
import { FilesList } from "../../files/list.tsx";
import { useErrorNotice } from "../../notices.tsx";
import { prepareCharacters } from "../character-state.ts";
import { ComputerSettings } from "./computer.tsx";
import { BotIdentity, IdentityEditor } from "./identity.tsx";
import { MemoryDialog } from "./memory.tsx";
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
  computer: "工作目录与权限",
  assistance: "Jev 辅助操作",
  skills: "技能",
  routines: "定时",
  prompt: "提示词",
  files: "文件与媒体",
};

export function BotDetails({
  bot,
  sessionBot = bot,
  active,
  view: requestedView,
  onViewChange,
  onClose,
  onBack,
  computer,
  chat,
  context,
  canManage,
  tab,
  onTabChange,
  expanded,
  onExpand,
  takeoverId,
  workRun,
  onWorkRunClose,
  onShowMessage,
}: {
  bot: Bot;
  sessionBot?: Bot;
  active: boolean;
  view: BotPanelView;
  onViewChange: (view: BotPanelView) => void;
  onClose: () => void;
  onBack?: () => void;
  computer: ReturnType<typeof useComputer>;
  chat: ReturnType<typeof useChat> & {
    model: ChatView["model"];
    busy: boolean;
  };
  context: ReactNode;
  canManage: boolean;
  tab: "bot" | "computer" | "browser" | "work";
  onTabChange: (tab: "bot" | "computer" | "browser" | "work") => void;
  expanded: boolean;
  onExpand: () => void;
  takeoverId?: string;
  workRun?: string;
  onWorkRunClose?: () => void;
  onShowMessage: (item: MessageTarget) => Promise<void>;
}) {
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [evidenceRun, setEvidenceRun] = useState<string>();
  const workActive =
    active &&
    ((requestedView === "root" && tab === "bot") ||
      requestedView === "skills" ||
      requestedView === "routines" ||
      memoryOpen);
  const work = useBotWork(
    bot.id,
    workActive,
    requestedView !== "root" || memoryOpen,
    active && requestedView === "identity",
  );
  const view =
    requestedView === "identity" && !work.profile ? "root" : requestedView;
  const current = useRef({ active, botId: bot.id, view });
  current.current = { active, botId: bot.id, view };
  useEffect(
    () => () => {
      current.current.active = false;
    },
    [],
  );
  const action = useWorkAction();
  const error =
    action.error ??
    (requestedView === "identity"
      ? work.profileError
      : workActive
        ? work.error
        : null);
  const retrySave = work.retrySave;
  useErrorNotice(
    error,
    action.error
      ? retrySave
        ? () => action.run("profile-retry", retrySave)
        : undefined
      : work.retry,
  );
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
        onOpenMemory={() => setMemoryOpen(true)}
      />
    );
  else if (view === "engine") content = <ModelSetup botId={bot.id} />;
  else if (view === "computer" || view === "assistance")
    content = (
      <ComputerSettings
        computer={computer}
        botId={bot.id}
        configuring={view === "assistance"}
        onConfigure={() => navigate("assistance")}
      />
    );
  else if (view === "skills")
    content = work.data ? (
      <SkillsPanel
        botId={bot.id}
        items={work.data.skills}
        nativeSkills={work.data.nativeSkills}
        action={action}
        editor={editor?.view === "skills" ? editor : null}
        onEditorChange={setSelection}
      />
    ) : (
      !work.error && <Loading label="正在读取技能" />
    );
  else if (view === "routines")
    content = work.data ? (
      <RoutinesPanel
        botId={bot.id}
        data={work.data.routines}
        chat={chat}
        skills={work.data.skills}
        action={action}
        editor={editor?.view === "routines" ? editor : null}
        onEditorChange={setSelection}
      />
    ) : (
      !work.error && <Loading label="正在读取定时任务" />
    );
  else if (view === "prompt")
    content = <PromptPanel botId={bot.id} action={action} />;
  else if (view === "files")
    content = <FilesList botId={bot.id} onShowMessage={onShowMessage} />;
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
            ? onBack
            : () =>
                editor
                  ? setSelection(null)
                  : navigate(view === "assistance" ? "computer" : "root")
        }
        onClose={onClose}
      />
      {view === "root" && (
        <div className="detail-identity">
          <BotIdentity
            bot={bot}
            profile={work.profile}
            pending={action.busy}
            onEdit={() => {
              void action.run("identity-prepare", async () => {
                await Promise.all([
                  work.prepareProfile(),
                  prepareCharacters(bot.id),
                ]);
                if (
                  current.current.active &&
                  current.current.botId === bot.id &&
                  current.current.view === "root"
                )
                  navigate("identity");
              });
            }}
          />
          <Tabs.Root
            className="bot-tabs"
            value={tab}
            onValueChange={(value) =>
              onTabChange(value as "bot" | "computer" | "browser" | "work")
            }
          >
            <Tabs.List className="workspace-tabs" aria-label="Bot详情">
              <Tabs.Tab className="navigation-tab" value="bot">
                Bot
              </Tabs.Tab>
              <Tabs.Tab className="navigation-tab" value="computer">
                Computer
              </Tabs.Tab>
              <Tabs.Tab className="navigation-tab" value="browser">
                Browser
              </Tabs.Tab>
              <Tabs.Tab className="navigation-tab" value="work">
                Work
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.Root>
        </div>
      )}
      {view === "root" &&
        tab === "work" &&
        active &&
        (sessionBot.id === bot.id ? (
          <WorkPanel
            {...chat}
            botId={bot.id}
            selectedRun={evidenceRun ?? workRun}
            onRunClose={() => {
              setEvidenceRun(undefined);
              onWorkRunClose?.();
            }}
          />
        ) : (
          <SessionWork
            key={sessionBot.id}
            botId={sessionBot.id}
            selectedRun={evidenceRun ?? workRun}
            onRunClose={() => {
              setEvidenceRun(undefined);
              onWorkRunClose?.();
            }}
          />
        ))}
      {view === "root" &&
        (tab === "computer" || tab === "browser") &&
        active && (
          <ComputerWorkspace
            takeoverId={takeoverId}
            key={`${tab}:${sessionBot.id}`}
            bot={sessionBot}
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
        {view === "identity" && work.profile && (
          <div>
            <IdentityEditor profile={work.profile} action={action} />
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
      {view === "routines" && editor?.view === "routines" && (
        <footer className="detail-footer form-actions">
          <Button
            variant="ghost"
            size="small"
            disabled={action.busy}
            onClick={() => setSelection(null)}
          >
            取消
          </Button>
          <Button
            type="submit"
            form={`routine-${bot.id}`}
            size="small"
            disabled={action.busy}
            aria-label="保存为暂停"
          >
            保存
          </Button>
        </footer>
      )}
      <MemoryDialog
        open={memoryOpen}
        onOpenChange={setMemoryOpen}
        botId={bot.id}
        items={work.data?.memory ?? []}
        reviewEnabled={work.data?.memoryReviewEnabled ?? true}
        usage={work.data?.memoryUsage ?? { profile: 0, work: 0 }}
        action={action}
        onEvidence={async (value) => {
          if (value.messageId && value.chat !== window.location.hash.slice(1)) {
            openChatTarget({
              ...value,
              sessionId: value.conversationId,
              messageId: value.messageId,
            });
          } else if (value.turnId) {
            setEvidenceRun(value.turnId);
            onTabChange("work");
          } else if (value.messageId)
            await onShowMessage({
              messageId: value.messageId,
              cursor: value.cursor,
              sessionId: value.conversationId,
            });
          else throw new Error("该出处没有可定位的聊天消息。");
        }}
      />
    </aside>
  );
}

function SessionWork({
  botId,
  selectedRun,
  onRunClose,
}: {
  botId: number;
  selectedRun?: string;
  onRunClose?: () => void;
}) {
  const chat = useChat(botId);
  return (
    <WorkPanel
      {...chat}
      botId={botId}
      selectedRun={selectedRun}
      onRunClose={onRunClose}
    />
  );
}
