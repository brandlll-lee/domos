import type { Bot } from "@domos/agent/bots";
import { Button } from "@domos/ui/controls";
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
  const { state, busy, error, configure } = useComputerServices(
    bot.id,
    Boolean(status?.authorized),
  );
  const item = state?.[service];
  const label = serviceLabels[service];
  const viewing = status?.authorized && item?.enabled;
  return (
    <section className="computer-workspace" aria-label={`${bot.name}的电脑`}>
      <div className="computer-workspace-stage">
        {viewing ? (
          <ComputerViewer
            takeoverId={takeoverId}
            botId={bot.id}
            service={service}
            expanded={expanded}
            onExpand={onExpand}
            onSettings={onSettings}
            installBrowser={
              admin && service === "browser"
                ? () => configure(service, true, true)
                : undefined
            }
            installing={busy === service}
          />
        ) : (
          <div className="computer-workspace-empty">
            {(!state || !status?.authorized) && (
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
                      : error
                        ? "电脑暂时无法连接"
                        : "正在连接电脑…"}
                </h3>
              </>
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
                  onClick={() => void configure(service, true)}
                >
                  启用{label}
                </Button>
              )
            )}
            {state && !admin && <p>请联系管理员启用{label}。</p>}
          </div>
        )}
        {!viewing && (
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
