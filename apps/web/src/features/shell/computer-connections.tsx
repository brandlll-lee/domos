import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { Loading } from "@domos/ui/loading";
import { ActionMenu } from "@domos/ui/menu";
import { InlineNotice } from "@domos/ui/message";
import { StatusDot, type StatusTone } from "@domos/ui/status-dot";
import { CubeIcon } from "@phosphor-icons/react/dist/csr/Cube";
import { DesktopTowerIcon } from "@phosphor-icons/react/dist/csr/DesktopTower";
import { NetworkIcon } from "@phosphor-icons/react/dist/csr/Network";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import type { ReactNode } from "react";
import type { DesktopState } from "../hosting/desktop.ts";
import "./computer-connections.css";

const serviceStatus = {
  starting: { label: "正在启动", tone: "warning" },
  ready: { label: "服务就绪", tone: "positive" },
  recovering: { label: "正在恢复", tone: "warning" },
  stopped: { label: "已停止", tone: "neutral" },
  failed: { label: "启动失败", tone: "negative" },
} as const;

export function ComputerConnections({
  state,
  connected,
  pending,
  error,
  open,
  onOpenChange,
  onAdd,
  onSelect,
  onRemove,
  onCancel,
  onRetry,
  children,
}: {
  state?: DesktopState;
  connected?: boolean;
  pending?: { action: "select" | "remove"; id: string };
  error?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: () => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onCancel: () => void;
  onRetry: () => void;
  children?: ReactNode;
}) {
  const target = state?.instances.find((item) => item.id === pending?.id);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="电脑连接"
      layout="task"
      className="computer-connections"
      footer={
        <div className="computer-connections-footer">
          <Button onClick={onAdd} disabled={!!pending}>
            <PlusIcon aria-hidden="true" />
            连接其他电脑
          </Button>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            完成
          </Button>
        </div>
      }
    >
      {!state ? (
        <div className="computer-connections-read">
          {error ? (
            <>
              <p>{error}</p>
              <Button variant="secondary" onClick={onRetry}>
                重新读取
              </Button>
            </>
          ) : (
            <Loading label="正在读取电脑连接" />
          )}
        </div>
      ) : (
        <>
          {pending && (
            <div className="computer-connections-progress" role="status">
              <InlineNotice>
                {pending.action === "select"
                  ? `正在连接 ${target?.name}`
                  : `正在移除 ${target?.name} 的连接`}
              </InlineNotice>
              {pending.action === "select" && (
                <Button variant="ghost" size="small" onClick={onCancel}>
                  取消
                </Button>
              )}
            </div>
          )}
          {!state.instances.length && (
            <p className="computer-connections-empty">还没有保存的电脑连接。</p>
          )}
          <ul className="computer-connection-list" aria-label="已保存的电脑">
            {state.instances.map((item) => {
              const current = item.id === state.selected;
              const runtime = current
                ? (state.runtime ?? item.runtime)
                : item.runtime;
              const kind =
                item.mode === "existing"
                  ? "remote"
                  : runtime === "docker"
                    ? "docker"
                    : "local";
              const Icon =
                kind === "remote"
                  ? NetworkIcon
                  : kind === "docker"
                    ? CubeIcon
                    : DesktopTowerIcon;
              const kindLabel =
                kind === "remote"
                  ? "远程电脑"
                  : kind === "docker"
                    ? "Docker 环境"
                    : "本机";
              let status: { label: string; tone: StatusTone } = {
                label: "状态未读取",
                tone: "neutral",
              };
              if (pending?.id === item.id && pending.action === "select") {
                status = { label: "正在连接", tone: "warning" };
              } else if (current) {
                if (state.service && state.service !== "ready")
                  status = serviceStatus[state.service];
                else if (connected === false)
                  status = { label: "连接中断", tone: "warning" };
                else if (connected === true)
                  status = { label: "已连接", tone: "positive" };
                else if (state.service) status = serviceStatus[state.service];
              }
              return (
                <li
                  className="computer-connection-row"
                  key={item.id}
                  data-current={current || undefined}
                  aria-label={item.name}
                >
                  <span
                    className="computer-connection-icon"
                    data-kind={kind}
                    role="img"
                    aria-label={kindLabel}
                    title={kindLabel}
                  >
                    <Icon aria-hidden="true" />
                    <StatusDot tone={status.tone} label={status.label} />
                  </span>
                  <span className="computer-connection-identity">
                    <strong>{item.name}</strong>
                    <span className="computer-connection-status">
                      {status.label}
                    </span>
                  </span>
                  <div className="computer-connection-actions">
                    {current ? (
                      <Button
                        variant="secondary"
                        size="small"
                        disabled
                        aria-current="true"
                        aria-label={`当前电脑：${item.name}`}
                      >
                        当前
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="small"
                        pending={
                          pending?.id === item.id && pending.action === "select"
                        }
                        disabled={!!pending}
                        onClick={() => onSelect(item.id)}
                        aria-label={`切换到 ${item.name}`}
                      >
                        切换
                      </Button>
                    )}
                    {item.mode === "existing" && (
                      <ActionMenu
                        label={`${item.name} 的更多操作`}
                        disabled={!!pending}
                        items={[
                          {
                            label: current ? "请先切换到其他电脑" : "移除连接",
                            icon: <TrashIcon />,
                            onSelect: () => onRemove(item.id),
                            disabled: current,
                          },
                        ]}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {children}
    </Dialog>
  );
}
