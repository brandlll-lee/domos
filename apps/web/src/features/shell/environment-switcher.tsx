import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { ActionMenu } from "@domos/ui/menu";
import { InlineNotice } from "@domos/ui/message";
import { SettingRow } from "@domos/ui/setting-row";
import { UnreadBadge } from "@domos/ui/unread-badge";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { MonitorIcon } from "@phosphor-icons/react/dist/csr/Monitor";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useEffect, useRef, useState } from "react";
import type { DesktopState } from "../hosting/desktop.ts";

export function EnvironmentSwitcher() {
  const desktop = window.domosDesktop;
  const [state, setState] = useState<DesktopState>();
  const [managing, setManaging] = useState(false);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const operation = useRef(0);
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
      <ActionMenu
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
        items={[
          ...(state?.instances ?? []).map((item) => ({
            label:
              item.mode === "local" && item.name === "这台电脑"
                ? "本机"
                : item.name,
            icon: item.unread ? (
              <UnreadBadge count={item.unread} />
            ) : item.id === state?.selected ? (
              <CheckIcon />
            ) : (
              <MonitorIcon />
            ),
            disabled: item.id === state?.selected,
            onSelect: () =>
              void run({ action: "select", id: item.id }, item.name),
          })),
          {
            label: "连接其他电脑…",
            icon: <PlusIcon />,
            separator: true,
            disabled: Boolean(pending),
            onSelect: () => void run({ action: "add" }),
          },
          { label: "管理连接", onSelect: () => setManaging(true) },
        ]}
      />
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
      {error && (
        <div className="environment-error" role="alert">
          <InlineNotice>{error}</InlineNotice>
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
