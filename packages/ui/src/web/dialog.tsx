import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { type ReactElement, type ReactNode, useRef, useState } from "react";
import { Button } from "./controls.tsx";
import { ScrollArea } from "./scroll-area.tsx";

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
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: ReactElement;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  finalFocus?: () => HTMLElement | null;
  footer?: ReactNode;
}) {
  const body = useRef<HTMLDivElement>(null);
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <BaseDialog.Trigger render={trigger} />}
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="dialog-backdrop" />
        <BaseDialog.Popup
          className={`dialog-popup ${className ?? ""}`}
          finalFocus={finalFocus}
          initialFocus={() =>
            Array.from(
              body.current?.querySelectorAll<HTMLElement>(
                "button, input, textarea, a[href], [role=combobox]",
              ) ?? [],
            ).find(
              (element) =>
                element.checkVisibility() && !element.matches(":disabled"),
            ) ??
            body.current?.parentElement?.querySelector<HTMLElement>(
              ".dialog-footer button",
            ) ??
            body.current
          }
        >
          <header className="dialog-header">
            <BaseDialog.Title className="dialog-title">
              {title}
            </BaseDialog.Title>
            <BaseDialog.Close
              aria-label="关闭弹窗"
              render={<Button variant="ghost" size="icon-small" />}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="m4 4 8 8m0-8-8 8" />
              </svg>
            </BaseDialog.Close>
          </header>
          {description && (
            <BaseDialog.Description className="dialog-description">
              {description}
            </BaseDialog.Description>
          )}
          <ScrollArea className="dialog-body" viewportRef={body}>
            {children}
          </ScrollArea>
          {footer && <footer className="dialog-footer">{footer}</footer>}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "删除",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      {null}
    </Dialog>
  );
}

export function ConfirmButton({
  title,
  description,
  onConfirm,
  disabled,
  children,
}: {
  title: string;
  description: string;
  onConfirm: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="small"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {children}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        onConfirm={onConfirm}
      />
    </>
  );
}
