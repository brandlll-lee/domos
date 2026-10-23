import type { Bot } from "@domos/agent/bots";
import type { ChatView } from "@domos/agent/view";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { PanelGroup, PanelRow } from "@domos/ui/panel";
import { SettingRow } from "@domos/ui/setting-row";
import { BrainIcon } from "@phosphor-icons/react/dist/csr/Brain";
import { ClockIcon } from "@phosphor-icons/react/dist/csr/Clock";
import { CpuIcon } from "@phosphor-icons/react/dist/csr/Cpu";
import { DesktopIcon } from "@phosphor-icons/react/dist/csr/Desktop";
import { LightningIcon } from "@phosphor-icons/react/dist/csr/Lightning";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { TerminalWindowIcon } from "@phosphor-icons/react/dist/csr/TerminalWindow";
import { computerLabels } from "../../computer/copy.ts";
import type { useComputer } from "../../computer/use-computer.ts";
import { EngineSelector } from "../../models/engine-selector.tsx";
import { EngineReasoning } from "./native-controls.tsx";
import type { BotPanelView } from "./types.ts";
import type { Profile, WorkData } from "./use-bot-work.ts";
import type { EngineSetup } from "./use-engine.ts";

export function RootPanel({
  bot,
  profile,
  data,
  engine,
  computer,
  chat,
  onNavigate,
}: {
  bot: Bot;
  profile: Profile | null;
  data: WorkData | null;
  engine: EngineSetup;
  computer: ReturnType<typeof useComputer>;
  chat: { model: ChatView["model"]; connected: boolean };
  onNavigate: (view: BotPanelView) => void;
}) {
  const status = computer.status;
  const computerValue = status
    ? status.authorized
      ? "已授权"
      : "待授权"
    : "仅聊天";
  const memory = data?.memory.length ?? 0;
  const skills =
    data?.skills.filter((item) => item.enabledBots.includes(bot.id)).length ??
    0;
  const routines =
    data?.routines.items.filter((item) => item.enabled).length ?? 0;
  return (
    <div className="panel-page">
      <section className="bot-hero" aria-label="Bot资料">
        <Button
          variant="ghost"
          size="icon"
          className="bot-hero-avatar"
          aria-label="编辑"
          onClick={() => onNavigate("identity")}
        >
          <BotAvatar
            seed={profile?.avatar ?? bot.avatar}
            size="panel"
            statusLabel="正在工作"
          />
          <span className="bot-hero-pencil" aria-hidden="true">
            <PencilSimpleIcon size={12} />
          </span>
        </Button>
        <div className="bot-hero-copy">
          <h2>{profile?.name ?? bot.name}</h2>
          {profile?.instructions.trim() && <p>{profile.instructions}</p>}
        </div>
      </section>

      {engine.error && (
        <p className="alert" role="alert">
          {engine.error}
        </p>
      )}

      <PanelGroup title="运行">
        <div className="engine-choices">
          <SettingRow title="模型">
            <EngineSelector
              setup={engine}
              model={chat.model}
              connected={chat.connected}
              onConfigure={() => onNavigate("engine")}
            />
          </SettingRow>
          <EngineReasoning setup={engine} />
        </div>
        <PanelRow
          icon={<CpuIcon />}
          title="连接与账号"
          value={
            engine.profile?.config.accountSource === "native"
              ? "工作电脑已有配置"
              : "Domos 管理"
          }
          onClick={() => onNavigate("engine")}
        />
        <PanelRow
          icon={<CpuIcon />}
          title="高级设置"
          onClick={() => onNavigate("advanced")}
        />
        <PanelRow
          icon={<DesktopIcon />}
          title="工作电脑"
          value={
            status
              ? `${status.name} · ${status.authorized ? computerLabels.state[status.state] : computerValue}`
              : "仅聊天"
          }
          onClick={() => onNavigate("computer")}
        />
      </PanelGroup>

      <PanelGroup title="能力">
        <PanelRow
          icon={<BrainIcon />}
          title="记忆"
          value={data ? `${memory} 条` : "读取中"}
          onClick={() => onNavigate("memory")}
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
