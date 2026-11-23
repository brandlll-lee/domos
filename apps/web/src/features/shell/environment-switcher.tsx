import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { InlineNotice } from "@domos/ui/message";
import { SettingRow } from "@domos/ui/setting-row";
import { UnreadBadge } from "@domos/ui/unread-badge";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { GearSixIcon } from "@phosphor-icons/react/dist/csr/GearSix";
import { MonitorIcon } from "@phosphor-icons/react/dist/csr/Monitor";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useEffect, useRef, useState } from "react";
import type { DesktopState } from "../hosting/desktop.ts";
import { useErrorNotice } from "../notices.tsx";
import { SidebarMenu, SidebarMenuItem } from "./sidebar-menu.tsx";

export function EnvironmentSwitcher() {
  const desktop = window.domosDesktop;
  const [state, setState] = useState<DesktopState>();
  const [managing, setManaging] = useState(false);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const operation = useRef(0);
  useErrorNotice(error);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void desktop
        ?.state()
        .then((result) => {
          if (!active) return;
          if (result.ok && result.value) setState(result.value);
          else setError(result.error ?? "无法读取电脑连接。");
        })
        .catch(() => {
          if (active) setError("无法读取电脑连接。");
        });
    refresh();
    window.addEventListener("domos:unread", refresh);
    return () => {
      active = false;
      window.removeEventListener("domos:unread", refresh);
    };
  }, []);
  if (!desktop) return null;
  const current = state?.instances.find((item) => item.id === state.selected);
  const label = current?.mode === "local" ? "本机" : (current?.name ?? "电脑");
  async function run(
    input: Parameters<NonNullable<typeof desktop>["connection"]>[0],
    name = "",
  ) {
    if (!desktop) return;
    const id = ++operation.current;
    setError("");
    setPending(
      input.action === "remove"
        ? "正在移除连接…"
        : name
          ? `正在连接 ${name}`
          : "",
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
      if (id === operation.current) setPending("");
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
                void run({ action: "select", id: item.id }, item.name);
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
      {pending && (
        <div className="environment-progress" role="status">
          <InlineNotice>{pending}</InlineNotice>
          <Button
            variant="ghost"
            size="small"
            onClick={() => void desktop.connection({ action: "cancel" })}
          >
            取消
          </Button>
        </div>
      )}
      <Dialog
        open={managing}
        onOpenChange={setManaging}
        title="电脑连接"
        footer={
          <div className="dialog-actions">
            <Button variant="secondary" onClick={() => setManaging(false)}>
              完成
            </Button>
          </div>
        }
      >
        <div className="settings-card">
          {state?.instances.map((item) => (
            <SettingRow
              key={item.id}
              title={
                item.mode === "local" && item.name === "这台电脑"
                  ? "本机"
                  : item.name
              }
              description={
                item.id === state.selected ? "当前工作区" : undefined
              }
            >
              {item.mode === "existing" && (
                <Button
                  variant="ghost"
                  size="small"
                  disabled={Boolean(pending) || item.id === state.selected}
                  title={
                    item.id === state.selected
                      ? "请先切换到其他电脑"
                      : undefined
                  }
                  onClick={() =>
                    void run({ action: "remove", id: item.id }, item.name)
                  }
                >
                  移除连接
                </Button>
              )}
            </SettingRow>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
