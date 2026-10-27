import { Button } from "@domos/ui/controls";
import { PanelDialog } from "@domos/ui/dialog";
import { layout } from "@domos/ui/tokens";
import { ChartBarIcon } from "@phosphor-icons/react/dist/csr/ChartBar";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { GearSixIcon } from "@phosphor-icons/react/dist/csr/GearSix";
import { ListIcon } from "@phosphor-icons/react/dist/csr/List";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import {
  type ReactNode,
  startTransition,
  useEffect,
  useState,
  ViewTransition,
} from "react";
import { EnvironmentSwitcher } from "./environment-switcher.tsx";
import { useWorkspaceLayout } from "./layout.ts";
import { ResizeHandle } from "./resize-handle.tsx";
import { Titlebar } from "./titlebar.tsx";
import "./style.css";

function interruptMotion() {
  document.activeViewTransition?.skipTransition();
}

export function Workspace({
  sidebar,
  inspector,
  detailsOpen,
  obscured,
  onDetailsChange,
  children,
  onSettings,
  usageOpen,
  onUsage,
  expanded = false,
  inspectorTitle = "Bot详情",
}: {
  sidebar: (compact: boolean, expand: () => void) => ReactNode;
  inspector: ReactNode;
  detailsOpen: boolean;
  obscured: boolean;
  onDetailsChange: (open: boolean) => void;
  children: ReactNode;
  onSettings: () => void;
  usageOpen: boolean;
  onUsage: () => void;
  expanded?: boolean;
  inspectorTitle?: string;
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
      content: sidebar(sizing.compact, sizing.expandSidebar),
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
      onPointerDownCapture={interruptMotion}
      onKeyDownCapture={interruptMotion}
      ref={sizing.setRoot}
      data-mobile={sizing.mobile || undefined}
      data-sidebar-compact={sizing.compact || undefined}
      data-platform={window.domosDesktop?.platform}
      data-details={(detailsOpen && !sizing.overlay && !expanded) || undefined}
      style={{
        gridTemplateColumns: `${sizing.mobile ? 0 : sizing.widths.sidebar}px minmax(0, 1fr) ${detailsOpen && !sizing.overlay && !expanded ? sizing.widths.inspector : 0}px`,
      }}
    >
      <Titlebar embedded />
      {sizing.mobile && (
        <Button
          id="contacts-trigger"
          className="contacts-trigger"
          variant="ghost"
          size="icon-small"
          aria-label="联系人"
          onClick={() => startTransition(() => setContactsOpen(true))}
        >
          <ListIcon />
        </Button>
      )}
      <ViewTransition update="panel-layout">
        <div className="workspace-content">{children}</div>
      </ViewTransition>
      {panels.map(({ side, title, modal, open, change, content }) => (
        <PanelDialog.Root
          key={side}
          open={open && !obscured}
          modal={modal}
          disablePointerDismissal={!modal}
          onOpenChange={(open) => startTransition(() => change(open))}
        >
          <PanelDialog.Portal
            container={sizing.root}
            keepMounted
            style={{ display: "contents" }}
          >
            {modal && <PanelDialog.Backdrop className="panel-backdrop" />}
            <ViewTransition
              update={side === "sidebar" ? "panel-layout" : "none"}
            >
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
                initialFocus={modal}
                finalFocus={() => {
                  if (document.activeElement?.closest(".workspace-content"))
                    return false;
                  const trigger = document.getElementById(
                    side === "sidebar" ? "contacts-trigger" : "details-trigger",
                  );
                  return trigger?.closest("[inert], [aria-hidden='true']")
                    ? false
                    : trigger;
                }}
              >
                <PanelDialog.Title className="sr-only">
                  {title}
                </PanelDialog.Title>
                {!modal && (
                  <ResizeHandle
                    side={side}
                    width={sizing.widths[side]}
                    min={
                      side === "sidebar"
                        ? layout.sidebar.compact
                        : layout[side].min
                    }
                    max={sizing.maximum[side]}
                    onResize={(width) => sizing.resize(side, width)}
                    onCommit={(width) => sizing.resize(side, width, true)}
                    onToggle={
                      side === "sidebar" ? sizing.toggleSidebar : undefined
                    }
                  />
                )}
                <div className="panel-body">
                  {content}
                  {side === "sidebar" && (
                    <footer className="sidebar-footer">
                      <EnvironmentSwitcher />
                      <nav aria-label="主导航">
                        <Button
                          variant="ghost"
                          size="icon-small"
                          aria-label="用量"
                          title="用量"
                          aria-pressed={usageOpen}
                          onClick={() => {
                            setContactsOpen(false);
                            onUsage();
                          }}
                        >
                          <ChartBarIcon />
                        </Button>
                        <Button
                          id="settings-trigger"
                          variant="ghost"
                          size="icon-small"
                          aria-label="设置"
                          title="设置"
                          onClick={() => {
                            setContactsOpen(false);
                            onSettings();
                          }}
                        >
                          <GearSixIcon aria-hidden="true" />
                        </Button>
                        {window.domosDesktop && (
                          <Button
                            variant="ghost"
                            size="icon-small"
                            aria-label="应用菜单"
                            title="应用菜单"
                            onClick={() => void window.domosDesktop?.menu()}
                          >
                            <DotsThreeIcon />
                          </Button>
                        )}
                        {modal && (
                          <PanelDialog.Close
                            aria-label="关闭联系人"
                            render={
                              <Button variant="ghost" size="icon-small" />
                            }
                          >
                            <XIcon />
                          </PanelDialog.Close>
                        )}
                      </nav>
                    </footer>
                  )}
                </div>
              </PanelDialog.Popup>
            </ViewTransition>
          </PanelDialog.Portal>
        </PanelDialog.Root>
      ))}
    </div>
  );
}
