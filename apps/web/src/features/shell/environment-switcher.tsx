import { Button } from "@domos/ui/controls";
import { InlineNotice } from "@domos/ui/message";
import { UnreadBadge } from "@domos/ui/unread-badge";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { GearSixIcon } from "@phosphor-icons/react/dist/csr/GearSix";
import { MonitorIcon } from "@phosphor-icons/react/dist/csr/Monitor";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection } from "../connection.ts";
import type { DesktopState } from "../hosting/desktop.ts";
import { useErrorNotice } from "../notices.tsx";
import { ComputerConnections } from "./computer-connections.tsx";
import { SidebarMenu, SidebarMenuItem } from "./sidebar-menu.tsx";

export function EnvironmentSwitcher() {
  const desktop = window.domosDesktop;
  const [state, setState] = useState<DesktopState>();
  const [managing, setManaging] = useState(false);
  const [pending, setPending] = useState<{
    action: "select" | "remove";
    id: string;
  }>();
  const connection = useConnection();
  const [error, setError] = useState("");
  const operation = useRef(0);
  useErrorNotice(error);
  const active = useRef(true);
  const refresh = useCallback(async () => {
    try {
      const result = await desktop?.state();
      if (!active.current || !result) return;
      if (!result.ok || !result.value)
        throw new Error(result.error ?? "无法读取电脑连接。");
      setState(result.value);
      setError("");
    } catch (cause) {
      if (active.current)
        setError(cause instanceof Error ? cause.message : "无法读取电脑连接。");
    }
  }, []);
  useEffect(() => {
    active.current = true;
    void refresh();
    window.addEventListener("domos:unread", refresh);
    return () => {
      active.current = false;
      operation.current++;
      window.removeEventListener("domos:unread", refresh);
    };
  }, [refresh]);
  if (!desktop) return null;
  const current = state?.instances.find((item) => item.id === state.selected);
  const label = current?.mode === "local" ? "本机" : (current?.name ?? "电脑");
  async function run(
    input: Parameters<NonNullable<typeof desktop>["connection"]>[0],
  ) {
    if (!desktop) return;
    const id = ++operation.current;
    setError("");
    setPending(
      input.action === "select" || input.action === "remove"
        ? input
        : undefined,
    );
    try {
      const result = await desktop.connection(input);
      if (id !== operation.current) return;
      if (!result.ok) throw new Error(result.error ?? "操作未完成。");
      if (input.action === "remove") {
        const next = await desktop.state();
        if (!next.ok || !next.value)
          throw new Error(next.error ?? "无法读取电脑连接。");
        setState(next.value);
      }
    } catch (cause) {
      if (id === operation.current)
        setError(
          cause instanceof Error ? cause.message : "连接未完成。请重试。",
        );
    } finally {
      if (id === operation.current) setPending(undefined);
    }
  }
  return (
    <div className="environment-switcher">
      <SidebarMenu
        label="切换电脑"
        trigger={
          <Button
            variant="ghost"
            size="small"
            className="environment-trigger"
            aria-label={`切换电脑：${label}`}
            title={label}
          >
            <MonitorIcon aria-hidden="true" />
            <span>{label}</span>
            <UnreadBadge
              count={(state?.instances ?? [])
                .filter((item) => item.id !== state?.selected)
                .reduce((sum, item) => sum + (item.unread ?? 0), 0)}
            />
            <CaretDownIcon aria-hidden="true" />
          </Button>
        }
        footer={
          <>
            <SidebarMenuItem
              label="连接其他电脑…"
              disabled={Boolean(pending)}
              onClick={() => void run({ action: "add" })}
            >
              <PlusIcon />
            </SidebarMenuItem>
            <SidebarMenuItem label="管理连接" onClick={() => setManaging(true)}>
              <GearSixIcon />
            </SidebarMenuItem>
          </>
        }
      >
        {(state?.instances ?? []).map((item) => (
          <SidebarMenuItem
            key={item.id}
            label={
              item.mode === "local" && item.name === "这台电脑"
                ? "本机"
                : item.name
            }
            current={item.id === state?.selected}
            onClick={() => {
              if (item.id !== state?.selected)
                void run({ action: "select", id: item.id });
            }}
          >
            <MonitorIcon />
            <span className="sidebar-menu-trailing">
              <UnreadBadge count={item.unread ?? 0} />
              {item.id === state?.selected && <CheckIcon />}
            </span>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
      {pending && !managing && (
        <div className="environment-progress" role="status">
          <InlineNotice>
            {pending.action === "select"
              ? `正在连接 ${state?.instances.find((item) => item.id === pending.id)?.name}`
              : "正在移除连接…"}
          </InlineNotice>
          {pending.action === "select" && (
            <Button
              variant="ghost"
              size="small"
              onClick={() => void run({ action: "cancel" })}
            >
              取消
            </Button>
          )}
        </div>
      )}
      <ComputerConnections
        open={managing}
        onOpenChange={setManaging}
        state={
          state
            ? {
                ...state,
                service:
                  state.mode === "local" && state.runtime !== "docker"
                    ? (connection.service ?? state.service)
                    : undefined,
              }
            : undefined
        }
        connected={connection.connected}
        pending={pending}
        error={error || undefined}
        onRetry={() => void refresh()}
        onAdd={() => {
          setManaging(false);
          void run({ action: "add" });
        }}
        onSelect={(id) => void run({ action: "select", id })}
        onRemove={(id) => void run({ action: "remove", id })}
        onCancel={() => void run({ action: "cancel" })}
      />
    </div>
  );
}
