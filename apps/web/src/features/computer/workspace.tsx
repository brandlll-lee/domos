import type { Bot } from "@domos/agent/bots";
import { Button } from "@domos/ui/controls";
import { PanelHeader } from "@domos/ui/panel";
import { Tabs } from "@domos/ui/tabs";
import { ArrowsInIcon } from "@phosphor-icons/react/dist/csr/ArrowsIn";
import { ArrowsOutIcon } from "@phosphor-icons/react/dist/csr/ArrowsOut";
import { DesktopIcon } from "@phosphor-icons/react/dist/csr/Desktop";
import { GearSixIcon } from "@phosphor-icons/react/dist/csr/GearSix";
import { GlobeIcon } from "@phosphor-icons/react/dist/csr/Globe";
import { useState } from "react";
import { computerLabels } from "./copy.ts";
import type { useComputer } from "./use-computer.ts";
import {
  type ComputerService,
  serviceLabels,
  useComputerServices,
} from "./use-services.ts";
import { ComputerViewer } from "./viewer.tsx";
import "./style.css";

export function ComputerWorkspace({
  bot,
  computer,
  admin,
  expanded,
  onExpand,
  onSettings,
  onClose,
}: {
  bot: Bot;
  computer: ReturnType<typeof useComputer>;
  admin: boolean;
  expanded: boolean;
  onExpand: () => void;
  onSettings: () => void;
  onClose: () => void;
}) {
  const [service, setService] = useState<ComputerService>("browser");
  const status = computer.status;
  const { state, busy, error, configure, reload } = useComputerServices(
    bot.id,
    Boolean(status?.authorized),
  );
  const item = state?.[service];
  const label = serviceLabels[service];
  return (
    <aside className="computer-workspace" aria-label={`${bot.name}的电脑`}>
      <PanelHeader
        title="工作电脑"
        onClose={onClose}
        actions={
          <Button
            variant="ghost"
            size="icon-small"
            aria-label={expanded ? "收起工作区" : "展开工作区"}
            onClick={onExpand}
          >
            {expanded ? <ArrowsInIcon /> : <ArrowsOutIcon />}
          </Button>
        }
      />
      <div className="computer-workspace-context">
        <span title={status?.name}>{status?.name ?? "尚未选择电脑"}</span>
        <Button
          variant="ghost"
          size="icon-small"
          aria-label="电脑设置"
          onClick={onSettings}
        >
          <GearSixIcon />
        </Button>
      </div>
      <Tabs.Root
        className="computer-workspace-tabs"
        value={service}
        onValueChange={(value) => setService(value as ComputerService)}
      >
        <Tabs.List className="workspace-tabs" aria-label="电脑画面">
          <Tabs.Tab className="workspace-tab" value="browser">
            <GlobeIcon />
            浏览器
          </Tabs.Tab>
          <Tabs.Tab className="workspace-tab" value="desktop">
            <DesktopIcon />
            桌面
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel
          className="computer-workspace-stage"
          value={service}
          key={service}
        >
          {status?.authorized && item?.enabled && item.available ? (
            <ComputerViewer botId={bot.id} service={service} />
          ) : (
            <div className="computer-workspace-empty">
              {service === "browser" ? (
                <GlobeIcon size={28} />
              ) : (
                <DesktopIcon size={28} />
              )}
              <h3>
                {!status
                  ? "为 Bot 选择一台电脑"
                  : !status.authorized
                    ? "电脑需要授权"
                    : !state
                      ? error
                        ? "电脑暂时无法连接"
                        : "正在连接工作电脑…"
                      : item?.enabled
                        ? `${label}尚未就绪`
                        : `${label}尚未启用`}
              </h3>
              {item?.error && <p>{item.error}</p>}
              {status && !status.authorized && (
                <p>{computerLabels.state[status.state]}</p>
              )}
              {!status?.authorized ? (
                <Button size="small" variant="secondary" onClick={onSettings}>
                  配置工作电脑
                </Button>
              ) : (
                state &&
                admin && (
                  <Button
                    size="small"
                    variant="secondary"
                    pending={busy === service}
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void configure(
                        service,
                        true,
                        service === "browser" &&
                          Boolean(item?.enabled) &&
                          !item?.available,
                      )
                    }
                  >
                    {item?.enabled
                      ? service === "browser"
                        ? "安装并连接浏览器"
                        : "重新检查桌面"
                      : `启用${label}`}
                  </Button>
                )
              )}
              {state && !admin && <p>请联系管理员启用{label}。</p>}
              {error && !state && (
                <Button size="small" variant="secondary" onClick={reload}>
                  重新连接
                </Button>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="alert">
              {error}
            </p>
          )}
        </Tabs.Panel>
      </Tabs.Root>
    </aside>
  );
}
