import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { useState } from "react";

export function ConfirmComputerAction({
  title,
  description,
  label,
  busy,
  error,
  onConfirm,
  variant = "secondary",
}: {
  title: string;
  description: string;
  label: string;
  busy: boolean;
  error: string;
  onConfirm: () => Promise<boolean>;
  variant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) setOpen(next);
      }}
      title={title}
      description={description}
      trigger={
        <Button variant={variant} size="small" disabled={busy}>
          {title}
        </Button>
      }
      footer={
        <div className="dialog-actions">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            取消
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              if (await onConfirm()) setOpen(false);
            }}
          >
            {busy ? "正在处理…" : label}
          </Button>
        </div>
      }
    >
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
