import type { Bot } from "@domos/agent/bots";
import { Button } from "@domos/ui/controls";
import { Disclosure } from "@domos/ui/disclosure";
import { DesktopIcon } from "@phosphor-icons/react/dist/csr/Desktop";
import { GearSixIcon } from "@phosphor-icons/react/dist/csr/GearSix";
import { GlobeIcon } from "@phosphor-icons/react/dist/csr/Globe";
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
  service,
  expanded,
  onExpand,
  onSettings,
  takeoverId,
}: {
  bot: Bot;
  computer: ReturnType<typeof useComputer>;
  admin: boolean;
  service: ComputerService;
  expanded: boolean;
  onExpand: () => void;
  onSettings: () => void;
  takeoverId?: string;
}) {
  const status = computer.status;
  const { state, busy, error, configure, reload } = useComputerServices(
    bot.id,
    Boolean(status?.authorized),
  );
  const item = state?.[service];
  const label = serviceLabels[service];
  const install =
    service === "browser" &&
    Boolean(item?.error?.includes("Chrome not found."));
  return (
    <section className="computer-workspace" aria-label={`${bot.name}的电脑`}>
      <div className="computer-workspace-stage">
        {status?.authorized && item?.enabled && item.available ? (
          <ComputerViewer
            takeoverId={takeoverId}
            botId={bot.id}
            service={service}
            expanded={expanded}
            onExpand={onExpand}
            onSettings={onSettings}
          />
        ) : (
          <div className="computer-workspace-empty">
            {(!state || !status?.authorized || item?.enabled) && (
              <>
                {service === "browser" ? (
                  <GlobeIcon size={28} />
                ) : (
                  <DesktopIcon size={28} />
                )}
                <h3>
                  {!status
                    ? "允许机器人访问此电脑"
                    : !status.authorized
                      ? "电脑需要授权"
                      : !state
                        ? error
                          ? "电脑暂时无法连接"
                          : "正在连接电脑…"
                        : item?.enabled
                          ? `${label}尚未就绪`
                          : `${label}尚未启用`}
                </h3>
              </>
            )}
            {item?.error && (
              <Disclosure label="错误详情">
                <p>{item.error}</p>
              </Disclosure>
            )}
            {error && (
              <p role="alert" className="alert">
                {error}
              </p>
            )}
            {status && !status.authorized && (
              <p>{computerLabels.state[status.state]}</p>
            )}
            {!status?.authorized ? (
              <Button size="small" variant="secondary" onClick={onSettings}>
                设置访问权限
              </Button>
            ) : (
              state &&
              admin && (
                <Button
                  size="small"
                  variant="secondary"
                  pending={busy === service}
                  disabled={Boolean(busy)}
                  onClick={() => void configure(service, true, install)}
                >
                  {item?.enabled
                    ? install
                      ? "安装并连接浏览器"
                      : `重新检查${label}`
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
        {!(status?.authorized && item?.enabled && item.available) && (
          <div className="computer-empty-controls">
            <Button
              variant="ghost"
              size="icon-small"
              aria-label="电脑设置"
              title="电脑设置"
              onClick={onSettings}
            >
              <GearSixIcon />
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
