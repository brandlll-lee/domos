import type { Bot } from "@domos/agent/bots";
import type { ChatView } from "@domos/agent/view";
import { SegmentedControl } from "@domos/ui/choice";
import { PanelGroup, PanelRow } from "@domos/ui/panel";
import { SettingRow } from "@domos/ui/setting-row";
import { BrainIcon } from "@phosphor-icons/react/dist/csr/Brain";
import { ClockIcon } from "@phosphor-icons/react/dist/csr/Clock";
import { CpuIcon } from "@phosphor-icons/react/dist/csr/Cpu";
import { LightningIcon } from "@phosphor-icons/react/dist/csr/Lightning";
import { TerminalWindowIcon } from "@phosphor-icons/react/dist/csr/TerminalWindow";
import type { ReactNode } from "react";
import type { useComputer } from "../../computer/use-computer.ts";
import { ModelSetting } from "../../models/model-setting.tsx";
import type { BotPanelView } from "./types.ts";
import type { WorkData } from "./use-bot-work.ts";

export function RootPanel({
  bot,
  data,
  chat,
  context,
  computer,
  canManage,
  onNavigate,
  onOpenMemory,
}: {
  bot: Bot;
  data: WorkData | null;
  chat: { model: ChatView["model"]; connected: boolean; busy: boolean };
  context: ReactNode;
  computer: ReturnType<typeof useComputer>;
  canManage: boolean;
  onNavigate: (view: BotPanelView) => void;
  onOpenMemory: () => void;
}) {
  const memory = data?.memory.length ?? 0;
  const skills =
    data?.skills.filter((item) => item.enabledBots.includes(bot.id)).length ??
    0;
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
            botId={bot.id}
            connected={chat.connected}
            disabled={computer.busy || chat.busy}
          />
          <SettingRow title="上下文">{context}</SettingRow>
          <SettingRow title="操作审批">
            <SegmentedControl
              label="操作审批"
              value={computer.approvalMode}
              onValueChange={computer.setApprovalMode}
              disabled={
                !canManage || computer.busy || !computer.status?.authorized
              }
              options={[
                { value: "ask", label: "询问" },
                {
                  value: "auto",
                  label: "自动",
                  title: "自动批准当前工作电脑上的操作。提问和登录仍需确认。",
                },
              ]}
            />
          </SettingRow>
        </div>
        <PanelRow
          icon={<CpuIcon />}
          title="连接与账号"
          value="工作电脑"
          onClick={() => onNavigate("engine")}
        />
      </PanelGroup>

      <PanelGroup title="能力">
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
          value={data ? `${routines} 个运行中` : "读取中"}
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
