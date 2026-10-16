import { Button } from "@domos/ui/controls";
import { PanelDialog } from "@domos/ui/dialog";
import { layout } from "@domos/ui/tokens";
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
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
  toolbar,
  actions,
  onSettings,
}: {
  sidebar: ReactNode;
  inspector: ReactNode;
  detailsOpen: boolean;
  onDetailsChange: (open: boolean) => void;
  children: ReactNode;
  toolbar: ReactNode;
  actions: ReactNode;
  onSettings: () => void;
}) {
  const sizing = useWorkspaceLayout(detailsOpen);
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
      title: "Bot详情",
      modal: sizing.overlay,
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
      style={
        {
          "--sidebar-size": `${sizing.mobile ? 0 : sizing.widths.sidebar}px`,
          "--inspector-size": `${detailsOpen && !sizing.overlay ? sizing.widths.inspector : 0}px`,
        } as CSSProperties
      }
    >
      <Titlebar
        onSettings={onSettings}
        onContacts={sizing.mobile ? () => setContactsOpen(true) : undefined}
        actions={actions}
      >
        {toolbar}
      </Titlebar>
      {children}
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
              aria-modal={modal || undefined}
              style={{
                width:
                  modal && side === "inspector"
                    ? undefined
                    : sizing.widths[side],
              }}
              initialFocus={modal || side === "inspector"}
              finalFocus={() =>
                document.getElementById(
                  side === "sidebar" ? "contacts-trigger" : "details-trigger",
                )
              }
            >
              <PanelDialog.Title className="sr-only">{title}</PanelDialog.Title>
              {modal && side === "sidebar" && (
                <PanelDialog.Close
                  render={<Button className="contacts-close" variant="ghost" />}
                >
                  关闭联系人
                </PanelDialog.Close>
              )}
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
              <div className="panel-body">{content}</div>
            </PanelDialog.Popup>
          </PanelDialog.Portal>
        </PanelDialog.Root>
      ))}
    </div>
  );
}
