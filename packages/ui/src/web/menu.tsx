import { Menu } from "@base-ui/react/menu";
import type { ReactElement, ReactNode } from "react";
import { Button } from "./controls.tsx";
import "./menu.css";

export { Caret } from "./caret.tsx";

function MoreIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle cx="3" cy="8" r="1.4" fill="currentColor" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" />
      <circle cx="13" cy="8" r="1.4" fill="currentColor" />
    </svg>
  );
}

export type ActionMenuItem = {
  label: string;
  icon?: ReactNode;
  separator?: boolean;
  onSelect: () => void;
  disabled?: boolean;
  tone?: "danger";
};

export function ActionMenu({
  label,
  items,
  disabled,
  trigger,
  side = "bottom",
}: {
  label: string;
  items: ActionMenuItem[];
  disabled?: boolean;
  trigger?: ReactElement;
  side?: "top" | "bottom";
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          trigger ?? (
            <Button
              variant="ghost"
              size="icon-small"
              className="action-menu-trigger"
              aria-label={label}
              disabled={disabled}
            />
          )
        }
      >
        {trigger ? undefined : <MoreIcon />}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          className="action-menu-positioner"
          sideOffset={4}
          side={side}
          align={side === "top" ? "start" : "end"}
        >
          <Menu.Popup className="action-menu">
            {items.map((item) => (
              <Menu.Item
                key={item.label}
                className="action-menu-item"
                data-tone={item.tone}
                data-separator={item.separator || undefined}
                disabled={item.disabled}
                onClick={item.onSelect}
              >
                {item.icon}
                {item.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
