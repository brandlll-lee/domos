import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { SearchField } from "@domos/ui/field";
import { Tabs } from "@domos/ui/tabs";
import type { ComponentProps, ReactNode } from "react";
import type { useCommandSelection } from "./use-command-selection.ts";
import "./command-dialog.css";

export function ChatCommandDialog({
  className,
  search,
  tabs,
  footer = <span className="command-hint">↑↓ 选择　Enter 打开　Esc 关闭</span>,
  ...props
}: Omit<ComponentProps<typeof Dialog>, "subheader"> & {
  search?: ComponentProps<typeof SearchField>;
  tabs?: {
    value: string;
    onValueChange: (value: string) => void;
    label: string;
    items: { value: string; label: string }[];
  };
}) {
  return (
    <Dialog
      {...props}
      className={`chat-command-dialog ${className ?? ""}`}
      footer={footer}
      subheader={
        search && (
          <div className="command-controls">
            <SearchField {...search} className="command-search" />
            {tabs && (
              <Tabs.Root value={tabs.value} onValueChange={tabs.onValueChange}>
                <Tabs.List className="command-tabs" aria-label={tabs.label}>
                  {tabs.items.map((tab) => (
                    <Tabs.Tab
                      key={tab.value}
                      className="navigation-tab"
                      value={tab.value}
                    >
                      {tab.label}
                    </Tabs.Tab>
                  ))}
                </Tabs.List>
              </Tabs.Root>
            )}
          </div>
        )
      }
    />
  );
}

export function CommandRow({
  id,
  command,
  className,
  label,
  current,
  onOpen,
  children,
  actions,
}: {
  id: string;
  command: ReturnType<typeof useCommandSelection>;
  className?: string;
  label?: string;
  current?: boolean;
  onOpen: () => void;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <tr className="command-row" {...command.rowProps(id)}>
      <td className="command-main-cell">
        <Button
          variant="ghost"
          className={`command-item ${className ?? ""}`}
          data-command-action
          aria-label={label}
          aria-current={current ? "page" : undefined}
          onKeyDown={command.keyDown}
          onClick={onOpen}
        >
          {children}
        </Button>
      </td>
      {actions && <td className="command-row-actions">{actions}</td>}
    </tr>
  );
}
