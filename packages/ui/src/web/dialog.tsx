import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { ReactElement, ReactNode } from "react";

export { BaseDialog as PanelDialog };

export function Dialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  className,
  finalFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: ReactElement;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
  finalFocus?: () => HTMLElement | null;
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <BaseDialog.Trigger render={trigger} />}
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="dialog-backdrop" />
        <BaseDialog.Popup
          className={`dialog-popup ${className ?? ""}`}
          finalFocus={finalFocus}
        >
          <BaseDialog.Title className="dialog-title">{title}</BaseDialog.Title>
          <BaseDialog.Description className="dialog-description">
            {description}
          </BaseDialog.Description>
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
