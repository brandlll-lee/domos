import { Brand } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { GearSixIcon } from "@phosphor-icons/react/dist/csr/GearSix";
import { ListIcon } from "@phosphor-icons/react/dist/csr/List";
import { type ReactNode, useEffect } from "react";
import "./style.css";

export function Titlebar({
  onSettings,
  onContacts,
  actions,
  children,
}: {
  onSettings?: () => void;
  onContacts?: () => void;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const desktop = window.domosDesktop;
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
    <header className="app-titlebar" data-platform={desktop?.platform}>
      <div className="titlebar-brand">
        {onContacts ? (
          <Button
            id="contacts-trigger"
            variant="ghost"
            size="icon-small"
            aria-label="联系人"
            onClick={onContacts}
          >
            <ListIcon />
          </Button>
        ) : (
          <Brand />
        )}
        {actions}
      </div>
      <div className="workspace-toolbar">{children}</div>
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
      {onSettings && (
        <Button
          id="settings-trigger"
          variant="ghost"
          size="icon-small"
          aria-label="设置"
          onClick={onSettings}
        >
          <GearSixIcon />
        </Button>
      )}
    </header>
  );
}
