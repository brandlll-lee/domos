import { Button } from "@domos/ui/controls";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CloudIcon } from "@phosphor-icons/react/dist/csr/Cloud";
import { MonitorIcon } from "@phosphor-icons/react/dist/csr/Monitor";
import { useEffect, useState } from "react";
import type { DesktopState } from "../hosting/desktop.ts";

export function EnvironmentSwitcher() {
  const desktop = window.domosDesktop;
  const [current, setCurrent] = useState<DesktopState["instances"][number]>();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void desktop
      ?.state()
      .then((result) => {
        if (!active) return;
        if (result.ok && result.value)
          setCurrent(
            result.value.instances.find(
              (item) => item.id === result.value?.selected,
            ),
          );
        else setError("无法读取当前环境");
      })
      .catch(() => {
        if (active) setError("无法读取当前环境");
      });
    return () => {
      active = false;
    };
  }, []);
  if (!desktop) return null;
  const Icon = current?.mode === "existing" ? CloudIcon : MonitorIcon;
  return (
    <div className="environment-switcher">
      <Button
        variant="ghost"
        size="small"
        className="environment-trigger"
        aria-label={`切换 Domos 环境：${current?.name ?? "选择环境"}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={current?.url}
        onClick={async () => {
          if (open) return;
          setError("");
          setOpen(true);
          try {
            const result = await desktop.menu("environment");
            if (!result.ok) setError("无法打开环境菜单");
          } catch {
            setError("无法打开环境菜单");
          } finally {
            setOpen(false);
          }
        }}
      >
        <Icon aria-hidden="true" />
        <span>{current?.name ?? "选择环境"}</span>
        <CaretDownIcon aria-hidden="true" />
      </Button>
      {error && (
        <p className="environment-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
