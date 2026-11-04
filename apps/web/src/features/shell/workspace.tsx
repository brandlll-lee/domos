import { Button } from "@domos/ui/controls";
import { PanelDialog } from "@domos/ui/dialog";
import { ActionMenu } from "@domos/ui/menu";
import { layout } from "@domos/ui/tokens";
import { ChartBarIcon } from "@phosphor-icons/react/dist/csr/ChartBar";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { GearSixIcon } from "@phosphor-icons/react/dist/csr/GearSix";
import { ListIcon } from "@phosphor-icons/react/dist/csr/List";
import { MonitorIcon } from "@phosphor-icons/react/dist/csr/Monitor";
import { StorefrontIcon } from "@phosphor-icons/react/dist/csr/Storefront";
import { UserIcon } from "@phosphor-icons/react/dist/csr/User";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import {
  addTransitionType,
  type ReactNode,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  ViewTransition,
} from "react";
import { flushSync } from "react-dom";
import { useWorkspaceLayout } from "./layout.ts";
import { ResizeHandle } from "./resize-handle.tsx";
import { Titlebar } from "./titlebar.tsx";
import "./style.css";

export function Workspace({
  sidebar,
  inspector,
  detailsOpen,
  obscured,
  onDetailsChange,
  children,
  onSettings,
  onApps,
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
  onApps: () => void;
  onUsage: () => void;
  expanded?: boolean;
  inspectorTitle?: string;
}) {
  const sizing = useWorkspaceLayout(detailsOpen && !expanded);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [menuError, setMenuError] = useState("");
  const [dragging, setDragging] = useState(false);
  useLayoutEffect(() => {
    // The viewport can change before its resize event reaches React.
    if (sizing.available !== window.innerWidth)
      document.activeViewTransition?.skipTransition();
  });
  useEffect(() => {
    const interrupt = (event: Event) => {
      const transition = document.activeViewTransition;
      if (!transition || !sizing.root?.contains(event.target as Node)) return;
      transition.skipTransition();
      flushSync(() => setDragging(false));
    };
    // React pauses synthetic events while the transition snapshot commits.
    window.addEventListener("pointerdown", interrupt, true);
    window.addEventListener("keydown", interrupt, true);
    window.addEventListener("beforeinput", interrupt, true);
    return () => {
      window.removeEventListener("pointerdown", interrupt, true);
      window.removeEventListener("keydown", interrupt, true);
      window.removeEventListener("beforeinput", interrupt, true);
    };
  }, [sizing.root]);
  const dragChange = useCallback(
    (dragging: boolean, moving = false) => {
      if (moving) sizing.setSnapping(false);
      setDragging(dragging);
    },
    [sizing.setSnapping],
  );
  useEffect(() => {
    const close = () => setContactsOpen(false);
    window.addEventListener("hashchange", close);
    return () => window.removeEventListener("hashchange", close);
  }, []);
  const desktopMenu = async (scope?: "environment") => {
    setMenuError("");
    try {
      const result = await window.domosDesktop?.menu(scope);
      if (!result?.ok) setMenuError("无法打开桌面菜单");
    } catch {
      setMenuError("无法打开桌面菜单");
    }
  };
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
      ref={sizing.setRoot}
      data-mobile={sizing.mobile || undefined}
      data-sidebar-compact={sizing.compact || undefined}
      data-sidebar-snapping={sizing.snapping || undefined}
      onTransitionEnd={(event) => {
        if (
          event.target === event.currentTarget &&
          event.propertyName === "grid-template-columns"
        )
          sizing.setSnapping(false);
      }}
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
          onClick={() =>
            startTransition(() => {
              addTransitionType("panel-layout");
              setContactsOpen(true);
            })
          }
        >
          <ListIcon />
        </Button>
      )}
      <ViewTransition
        update={
          dragging || sizing.snapping
            ? "none"
            : { default: "none", "panel-layout": "panel-layout" }
        }
      >
        <div
          className="workspace-content"
          data-resizing={dragging || undefined}
        >
          {children}
        </div>
      </ViewTransition>
      {panels.map(({ side, title, modal, open, change, content }) => (
        <PanelDialog.Root
          key={side}
          open={open && !obscured}
          modal={modal}
          disablePointerDismissal={!modal}
          onOpenChange={(open) =>
            startTransition(() => {
              addTransitionType("panel-layout");
              change(open);
            })
          }
        >
          <PanelDialog.Portal
            container={sizing.root}
            keepMounted
            style={{ display: "contents" }}
          >
            {modal && <PanelDialog.Backdrop className="panel-backdrop" />}
            <ViewTransition
              update={
                side === "sidebar" && !dragging && !sizing.snapping
                  ? { default: "none", "panel-layout": "panel-layout" }
                  : "none"
              }
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
                  if (obscured) return false;
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
                    onDragChange={dragChange}
                  />
                )}
                <div className="panel-body">
                  {side === "sidebar" && modal && (
                    <PanelDialog.Close
                      className="contacts-close"
                      aria-label="关闭联系人"
                      render={<Button variant="ghost" size="icon-small" />}
                    >
                      <XIcon />
                    </PanelDialog.Close>
                  )}
                  {content}
                  {side === "sidebar" && (
                    <footer className="sidebar-footer">
                      <ActionMenu
                        label="用户菜单"
                        side="top"
                        trigger={
                          <Button
                            id="settings-trigger"
                            variant="secondary"
                            size="icon"
                            aria-label="用户菜单"
                            title="用户菜单"
                          >
                            <UserIcon aria-hidden="true" />
                          </Button>
                        }
                        items={[
                          {
                            label: "设置",
                            icon: <GearSixIcon />,
                            onSelect: () => {
                              setContactsOpen(false);
                              onSettings();
                            },
                          },
                          {
                            label: "用量",
                            icon: <ChartBarIcon />,
                            onSelect: () => {
                              setContactsOpen(false);
                              onUsage();
                            },
                          },
                          ...(window.domosDesktop
                            ? [
                                {
                                  label: "切换电脑",
                                  icon: <MonitorIcon />,
                                  separator: true,
                                  onSelect: () =>
                                    void desktopMenu("environment"),
                                },
                                {
                                  label: "桌面操作",
                                  icon: <DotsThreeIcon />,
                                  onSelect: () => void desktopMenu(),
                                },
                              ]
                            : []),
                        ]}
                      />
                      <Button
                        variant="secondary"
                        size="small"
                        className="apps-trigger"
                        aria-label="连接中心"
                        title="连接中心"
                        onClick={onApps}
                      >
                        <StorefrontIcon aria-hidden="true" />
                        <span>连接中心</span>
                      </Button>
                      {menuError && (
                        <p className="sidebar-menu-error" role="alert">
                          {menuError}
                        </p>
                      )}
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
