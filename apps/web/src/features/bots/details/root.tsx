import type { Bot } from "@domos/agent/bots";
import type { ChatView } from "@domos/agent/view";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { BrainIcon } from "@phosphor-icons/react/dist/csr/Brain";
import { ChatCircleDotsIcon } from "@phosphor-icons/react/dist/csr/ChatCircleDots";
import { ClockIcon } from "@phosphor-icons/react/dist/csr/Clock";
import { CpuIcon } from "@phosphor-icons/react/dist/csr/Cpu";
import { DesktopIcon } from "@phosphor-icons/react/dist/csr/Desktop";
import { LightningIcon } from "@phosphor-icons/react/dist/csr/Lightning";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { TerminalWindowIcon } from "@phosphor-icons/react/dist/csr/TerminalWindow";
import { computerLabels } from "../../computer/copy.ts";
import type { useComputer } from "../../computer/use-computer.ts";
import { PanelRow } from "./row.tsx";
import type { BotPanelView } from "./types.ts";
import type { Profile, WorkData } from "./use-bot-work.ts";
import type { EngineSetup } from "./use-engine.ts";

export function RootPanel({
  bot,
  profile,
  data,
  engine,
  model,
  computer,
  onNavigate,
}: {
  bot: Bot;
  profile: Profile | null;
  data: WorkData | null;
  engine: EngineSetup;
  model: ChatView["model"];
  computer: ReturnType<typeof useComputer>;
  onNavigate: (view: BotPanelView) => void;
}) {
  const provider = engine.profile?.config.provider;
  const engineName =
    engine.profile?.providers.find((item) => item.id === provider)?.name ??
    provider ??
    "任务引擎";
  const engineValue = engine.profile
    ? engine.profile.prepared
      ? "已就绪"
      : "待连接"
    : engine.error
      ? "读取失败"
      : "读取中";
  const selectedModel =
    provider === "pi"
      ? model && `${model.provider} / ${model.modelId}`
      : engine.profile?.config.model;
  const modelValue =
    selectedModel ??
    (provider && provider !== "pi" ? "使用引擎默认模型" : "未选择");
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
        <BotAvatar
          seed={profile?.avatar ?? bot.avatar}
          size="panel"
          statusLabel="正在工作"
        />
        <div className="bot-hero-copy">
          <h2>{profile?.name ?? bot.name}</h2>
          <p>{profile?.instructions.trim() || "还没有填写职责与长期指令。"}</p>
        </div>
        <Button
          variant="ghost"
          size="small"
          className="bot-hero-edit"
          onClick={() => onNavigate("identity")}
        >
          <PencilSimpleIcon size={15} />
          编辑
        </Button>
      </section>

      {engine.error && !engine.profile && (
        <p className="alert" role="alert">
          {engine.error}
        </p>
      )}

      <section className="panel-group" aria-labelledby="bot-run-title">
        <h3 id="bot-run-title" className="panel-group-title">
          运行
        </h3>
        <div className="panel-card">
          <PanelRow
            icon={<CpuIcon />}
            title="任务引擎"
            summary={engineName}
            value={engineValue}
            onClick={() => onNavigate("engine")}
          />
          <PanelRow
            icon={<ChatCircleDotsIcon />}
            title="对话模型"
            summary={modelValue}
            value={provider === "pi" && !model ? "待选择" : undefined}
            onClick={() => onNavigate("engine")}
          />
          <PanelRow
            icon={<DesktopIcon />}
            title="工作电脑"
            summary={
              status
                ? `${computerLabels.state[status.state]} · ${status.name}`
                : "此 Bot 只聊天，不操作文件和命令。"
            }
            value={computerValue}
            onClick={() => onNavigate("computer")}
          />
        </div>
      </section>

      <section className="panel-group" aria-labelledby="bot-work-title">
        <h3 id="bot-work-title" className="panel-group-title">
          能力
        </h3>
        <div className="panel-card">
          <PanelRow
            icon={<BrainIcon />}
            title="记忆"
            summary="长期事实与偏好"
            value={data ? `${memory} 条` : "读取中"}
            onClick={() => onNavigate("memory")}
          />
          <PanelRow
            icon={<LightningIcon />}
            title="技能"
            summary="从共享技能库选用"
            value={data ? `${skills} 个启用` : "读取中"}
            onClick={() => onNavigate("skills")}
          />
          <PanelRow
            icon={<ClockIcon />}
            title="定时"
            summary="按计划自动执行"
            value={data ? `${routines} 个运行中` : "读取中"}
            onClick={() => onNavigate("routines")}
          />
          <PanelRow
            icon={<TerminalWindowIcon />}
            title="提示词"
            summary="查看最近交给引擎的指令"
            value="只读"
            onClick={() => onNavigate("prompt")}
          />
        </div>
      </section>
    </div>
  );
}
