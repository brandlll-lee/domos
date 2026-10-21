import { Popover } from "@base-ui/react/popover";
import type { ReactNode } from "react";
import { Button } from "./controls.tsx";
import "./context-window.css";

const tokens = (value: number | null | undefined) =>
  value == null
    ? "未提供"
    : new Intl.NumberFormat("en", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value);

export function ContextWindow({
  used,
  capacity,
  estimated,
  children,
}: {
  used: number | null | undefined;
  capacity: number | null | undefined;
  estimated?: boolean;
  children: ReactNode;
}) {
  const percent =
    used != null && capacity != null && capacity > 0
      ? (used / capacity) * 100
      : null;
  const free =
    used != null && capacity != null ? Math.max(0, capacity - used) : null;
  const label = `${estimated ? "约 " : ""}${tokens(used)} / ${tokens(capacity)}${percent == null ? "" : ` (${new Intl.NumberFormat("zh", { maximumFractionDigits: 1 }).format(percent)}%)`}`;
  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <Button
            variant="ghost"
            size="small"
            className="context-window-trigger"
            aria-label="上下文窗口"
          />
        }
      >
        <span>上下文 {label}</span>
        <span aria-hidden="true">⌄</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="context-window-positioner"
        >
          <Popover.Popup className="context-window-popup">
            <header className="context-window-header">
              <Popover.Title>上下文窗口</Popover.Title>
              <span title={used == null ? undefined : used.toLocaleString()}>
                {label}
              </span>
            </header>
            {percent != null && (
              <div
                className="context-window-bar"
                role="img"
                aria-label={`已用 ${label}`}
              >
                <span style={{ width: `${Math.min(100, percent)}%` }} />
              </div>
            )}
            <dl className="context-window-values">
              <div>
                <dt>
                  <i className="context-window-used" aria-hidden="true" />
                  已用上下文{estimated ? "（估算）" : ""}
                </dt>
                <dd>{tokens(used)}</dd>
                <dd>{percent == null ? "—" : `${percent.toFixed(1)}%`}</dd>
              </div>
              <div>
                <dt>
                  <i className="context-window-free" aria-hidden="true" />
                  剩余空间
                </dt>
                <dd>{tokens(free)}</dd>
                <dd>
                  {percent == null
                    ? "—"
                    : `${Math.max(0, 100 - percent).toFixed(1)}%`}
                </dd>
              </div>
            </dl>
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
