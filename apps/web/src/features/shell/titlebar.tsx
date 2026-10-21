import { Button } from "@domos/ui/controls";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { ListIcon } from "@phosphor-icons/react/dist/csr/List";
import { type ReactNode, useEffect, useRef } from "react";
import { EnvironmentSwitcher } from "./environment-switcher.tsx";
import "./style.css";

type ControlsOverlay = {
  visible: boolean;
  getTitlebarAreaRect?: () => DOMRect;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

const windowControls = () =>
  (navigator as Navigator & { windowControlsOverlay?: ControlsOverlay })
    .windowControlsOverlay;

export function Titlebar({
  onContacts,
  actions,
  sidebarWidth,
}: {
  onContacts?: () => void;
  actions?: ReactNode;
  sidebarWidth?: number;
}) {
  const desktop = window.domosDesktop;
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const overlay = windowControls();
    if (!overlay) return;
    const sync = () => {
      const rect = overlay.visible
        ? overlay.getTitlebarAreaRect?.()
        : undefined;
      const style = bar.current?.style;
      if (!rect || !style) return;
      style.setProperty(
        "--titlebar-inset-start",
        `${Math.max(0, Math.round(rect.left))}px`,
      );
      style.setProperty(
        "--titlebar-inset-end",
        `${Math.max(0, Math.round(window.innerWidth - rect.right))}px`,
      );
    };
    sync();
    overlay.addEventListener?.("geometrychange", sync);
    window.addEventListener("resize", sync);
    return () => {
      overlay.removeEventListener?.("geometrychange", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);
  useEffect(() => {
    if (!desktop?.appearance) return;
    const sync = () =>
      void desktop.appearance(
        document.documentElement.dataset.theme === "dark" ? "dark" : "light",
      );
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return (
    <header
      className="app-titlebar"
      data-platform={desktop?.platform}
      ref={bar}
    >
      <div
        className="titlebar-actions"
        style={
          sidebarWidth === undefined
            ? undefined
            : {
                width: `calc(${sidebarWidth}px + var(--rail-width) - var(--space-3))`,
              }
        }
      >
        {onContacts && (
          <Button
            id="contacts-trigger"
            variant="ghost"
            size="icon-small"
            aria-label="联系人"
            onClick={onContacts}
          >
            <ListIcon />
          </Button>
        )}
        <EnvironmentSwitcher />
        {actions}
      </div>
      {desktop && (
        <Button
          variant="ghost"
          size="icon-small"
          aria-label="应用菜单"
          onClick={() => void desktop.menu()}
        >
          <DotsThreeIcon />
        </Button>
      )}
    </header>
  );
}
