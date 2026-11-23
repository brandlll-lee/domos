import { Menu } from "@domos/ui/menu";
import { ScrollArea } from "@domos/ui/scroll-area";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import "./sidebar-menu.css";

export function SidebarMenu({
  label,
  trigger,
  hover,
  header,
  footer,
  children,
}: {
  label: string;
  trigger: ReactElement;
  hover?: boolean;
  header?: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger render={trigger} openOnHover={hover} closeDelay={150} />
      <Menu.Portal>
        <Menu.Positioner
          className="popover-positioner"
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={8}
        >
          <Menu.Popup
            className="popover-surface sidebar-menu"
            aria-label={label}
          >
            {header && <div className="sidebar-menu-actions">{header}</div>}
            <ScrollArea className="sidebar-menu-list">{children}</ScrollArea>
            <div className="sidebar-menu-actions">{footer}</div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function SidebarMenuItem({
  label,
  current,
  children,
  ...props
}: Omit<ComponentProps<typeof Menu.Item>, "className"> & {
  label: string;
  current?: boolean;
}) {
  return (
    <Menu.Item
      {...props}
      className="sidebar-menu-row"
      aria-label={label}
      aria-current={current ? "page" : undefined}
    >
      <span className="sidebar-menu-label">{label}</span>
      {children}
    </Menu.Item>
  );
}
