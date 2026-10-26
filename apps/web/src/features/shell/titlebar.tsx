import { Button } from "@domos/ui/controls";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { useEffect } from "react";
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

export function Titlebar({ embedded = false }: { embedded?: boolean }) {
  const desktop = window.domosDesktop;
  useEffect(() => {
    const overlay = windowControls();
    if (!overlay) return;
    const sync = () => {
      const rect = overlay.visible
        ? overlay.getTitlebarAreaRect?.()
        : undefined;
      const style = document.documentElement.style;
      if (!rect || !style) return;
      style.setProperty(
        "--window-inset-start",
        `${Math.max(0, Math.round(rect.left))}px`,
      );
      style.setProperty(
        "--window-inset-end",
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
  if (embedded) return null;
  return (
    <header className="app-titlebar" data-platform={desktop?.platform}>
      <div className="titlebar-actions">
        <EnvironmentSwitcher />
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
