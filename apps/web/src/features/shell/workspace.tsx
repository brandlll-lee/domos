import { Button } from "@domos/ui/controls";
import { PanelDialog } from "@domos/ui/dialog";
import { layout } from "@domos/ui/tokens";
import { ChatTextIcon } from "@phosphor-icons/react/dist/csr/ChatText";
import { DesktopIcon } from "@phosphor-icons/react/dist/csr/Desktop";
import { GearSixIcon } from "@phosphor-icons/react/dist/csr/GearSix";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { type ReactNode, useEffect, useState } from "react";
import { useWorkspaceLayout } from "./layout.ts";
import { ResizeHandle } from "./resize-handle.tsx";
import { Titlebar } from "./titlebar.tsx";
import "./style.css";

export function Workspace({
  sidebar,
  inspector,
  detailsOpen,
  onDetailsChange,
  children,
  actions,
  onSettings,
  onConversation,
  onComputer,
  computerOpen = false,
  expanded = false,
  inspectorTitle = "Bot详情",
  inspectorTrigger = "details-trigger",
}: {
  sidebar: ReactNode;
  inspector: ReactNode;
  detailsOpen: boolean;
  onDetailsChange: (open: boolean) => void;
  children: ReactNode;
  actions: ReactNode;
  onSettings: () => void;
  onConversation: () => void;
  onComputer: () => void;
  computerOpen?: boolean;
  expanded?: boolean;
  inspectorTitle?: string;
  inspectorTrigger?: string;
}) {
  const sizing = useWorkspaceLayout(detailsOpen && !expanded);
  const [contactsOpen, setContactsOpen] = useState(false);
  useEffect(() => {
    const close = () => setContactsOpen(false);
    window.addEventListener("hashchange", close);
    return () => window.removeEventListener("hashchange", close);
  }, []);
  const panels = [
    {
      side: "sidebar" as const,
      title: "联系人",
      modal: sizing.mobile,
      open: !sizing.mobile || contactsOpen,
      change: setContactsOpen,
      content: sidebar,
    },
    {
      side: "inspector" as const,
      title: inspectorTitle,
      modal: sizing.overlay || expanded,
      open: detailsOpen,
      change: onDetailsChange,
      content: inspector,
    },
  ];
  return (
    <div
      className="workspace"
      ref={sizing.setRoot}
      data-mobile={sizing.mobile || undefined}
      style={{
        gridTemplateColumns: `${sizing.mobile ? 0 : sizing.widths.sidebar}px minmax(0, 1fr) ${detailsOpen && !sizing.overlay && !expanded ? sizing.widths.inspector : 0}px`,
      }}
    >
      <Titlebar
        sidebarWidth={sizing.mobile ? undefined : sizing.widths.sidebar}
        onContacts={sizing.mobile ? () => setContactsOpen(true) : undefined}
        actions={actions}
      />
      {!sizing.mobile && (
        <nav className="app-rail" aria-label="主导航">
          <div className="rail-group">
            <Button
              variant="ghost"
              size="icon"
              className="rail-button"
              aria-label="会话"
              title="会话"
              aria-current={computerOpen ? undefined : "page"}
              onClick={onConversation}
            >
              <ChatTextIcon
                size={20}
                weight={computerOpen ? "regular" : "fill"}
                aria-hidden="true"
              />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="rail-button"
              aria-label="工作电脑"
              title="工作电脑"
              aria-current={computerOpen ? "page" : undefined}
              onClick={onComputer}
            >
              <DesktopIcon
                size={20}
                weight={computerOpen ? "fill" : "regular"}
                aria-hidden="true"
              />
            </Button>
          </div>
          <div className="rail-group" data-bottom>
            <Button
              id="settings-trigger"
              variant="ghost"
              size="icon"
              className="rail-button"
              aria-label="设置"
              title="设置"
              onClick={onSettings}
            >
              <GearSixIcon size={20} aria-hidden="true" />
            </Button>
          </div>
        </nav>
      )}
      <div className="workspace-content">{children}</div>
      {panels.map(({ side, title, modal, open, change, content }) => (
        <PanelDialog.Root
          key={side}
          open={open}
          modal={modal}
          disablePointerDismissal={!modal}
          onOpenChange={change}
        >
          <PanelDialog.Portal container={sizing.root} keepMounted>
            {modal && <PanelDialog.Backdrop className="panel-backdrop" />}
            <PanelDialog.Popup
              className="workspace-panel"
              data-side={side}
              data-modal={modal || undefined}
              data-expanded={(side === "inspector" && expanded) || undefined}
              aria-modal={modal || undefined}
              style={{
                width:
                  modal && side === "inspector"
                    ? undefined
                    : sizing.widths[side],
              }}
              initialFocus={modal || side === "inspector"}
              finalFocus={() => {
                const trigger = document.getElementById(
                  side === "sidebar" ? "contacts-trigger" : inspectorTrigger,
                );
                return trigger?.closest("[inert], [aria-hidden='true']")
                  ? false
                  : trigger;
              }}
            >
              <PanelDialog.Title className="sr-only">{title}</PanelDialog.Title>
              {!modal && (
                <ResizeHandle
                  side={side}
                  width={sizing.widths[side]}
                  min={layout[side].min}
                  max={sizing.maximum[side]}
                  onResize={(width) => sizing.resize(side, width)}
                  onCommit={(width) => sizing.resize(side, width, true)}
                />
              )}
              <div className="panel-body">
                {content}
                {side === "sidebar" && modal && (
                  <footer className="sidebar-footer">
                    <Button
                      id="settings-trigger"
                      variant="ghost"
                      size="small"
                      onClick={() => {
                        setContactsOpen(false);
                        onSettings();
                      }}
                    >
                      <GearSixIcon aria-hidden="true" />
                      设置
                    </Button>
                    <PanelDialog.Close
                      aria-label="关闭联系人"
                      render={<Button variant="ghost" size="icon-small" />}
                    >
                      <XIcon />
                    </PanelDialog.Close>
                  </footer>
                )}
              </div>
            </PanelDialog.Popup>
          </PanelDialog.Portal>
        </PanelDialog.Root>
      ))}
    </div>
  );
}
