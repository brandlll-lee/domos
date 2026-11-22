import type { Bot } from "@domos/agent/bots";
import type { ChatView } from "@domos/agent/view";
import { PanelGroup, PanelRow } from "@domos/ui/panel";
import { SettingRow } from "@domos/ui/setting-row";
import { BrainIcon } from "@phosphor-icons/react/dist/csr/Brain";
import { ClockIcon } from "@phosphor-icons/react/dist/csr/Clock";
import { CpuIcon } from "@phosphor-icons/react/dist/csr/Cpu";
import { FilesIcon } from "@phosphor-icons/react/dist/csr/Files";
import { FolderIcon } from "@phosphor-icons/react/dist/csr/Folder";
import { LightningIcon } from "@phosphor-icons/react/dist/csr/Lightning";
import { TerminalWindowIcon } from "@phosphor-icons/react/dist/csr/TerminalWindow";
import type { ReactNode } from "react";
import type { useComputer } from "../../computer/use-computer.ts";
import { ApprovalSetting } from "../../models/approval-setting.tsx";
import { ModelSetting } from "../../models/model-setting.tsx";
import type { BotPanelView } from "./types.ts";
import type { WorkData } from "./use-bot-work.ts";

export function RootPanel({
  bot,
  sessionId = bot.id,
  data,
  chat,
  context,
  computer,
  canManage,
  onNavigate,
  onOpenMemory,
}: {
  bot: Bot;
  sessionId?: number;
  data: WorkData | null;
  chat: { model: ChatView["model"]; connected: boolean; busy: boolean };
  context: ReactNode;
  computer: ReturnType<typeof useComputer>;
  canManage: boolean;
  onNavigate: (view: BotPanelView) => void;
  onOpenMemory: () => void;
}) {
  const memory = data?.memory.length ?? 0;
  const skills = new Set([
    ...(data?.nativeSkills?.map((item) => item.name) ?? []),
    ...(data?.skills
      .filter((item) => item.enabledBots.includes(bot.id))
      .map((item) => item.name) ?? []),
  ]).size;
  const routines =
    data?.routines.items.filter((item) => item.enabled).length ?? 0;
  return (
    <div className="panel-page">
      {computer.error && (
        <p className="alert" role="alert">
          {computer.error}
        </p>
      )}

      <PanelGroup title="运行">
        <div className="engine-choices">
          <ModelSetting
            botId={sessionId}
            connected={chat.connected}
            disabled={computer.busy || chat.busy}
          />
          <SettingRow title="上下文">{context}</SettingRow>
          <ApprovalSetting
            botId={sessionId}
            disabled={
              !canManage ||
              computer.busy ||
              chat.busy ||
              !computer.status?.authorized
            }
          />
        </div>
        <PanelRow
          icon={<CpuIcon />}
          title="模型与账号"
          onClick={() => onNavigate("engine")}
        />
        <PanelRow
          icon={<FolderIcon />}
          title="工作目录与权限"
          onClick={() => onNavigate("computer")}
        />
      </PanelGroup>

      <PanelGroup title="能力">
        <PanelRow
          icon={<FilesIcon />}
          title="文件与媒体"
          onClick={() => onNavigate("files")}
        />
        <PanelRow
          icon={<BrainIcon />}
          title="记忆"
          value={data ? `${memory} 条` : "读取中"}
          onClick={onOpenMemory}
        />
        <PanelRow
          icon={<LightningIcon />}
          title="技能"
          value={data ? `${skills} 个启用` : "读取中"}
          onClick={() => onNavigate("skills")}
        />
        <PanelRow
          icon={<ClockIcon />}
          title="定时"
          value={data ? `${routines} 个已启用` : "读取中"}
          onClick={() => onNavigate("routines")}
        />
        <PanelRow
          icon={<TerminalWindowIcon />}
          title="提示词"
          value="只读"
          onClick={() => onNavigate("prompt")}
        />
      </PanelGroup>
    </div>
  );
}
