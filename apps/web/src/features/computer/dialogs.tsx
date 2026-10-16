import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { type ReactNode, useState } from "react";

export function ComputerDetails({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={name}
      description="查看电脑的工作目录、能力与网络。"
      trigger={<Button variant="ghost">查看详情</Button>}
    >
      {children}
      <div className="dialog-actions">
        <Button variant="secondary" onClick={() => setOpen(false)}>
          关闭详情
        </Button>
      </div>
    </Dialog>
  );
}

export function ConfirmComputerAction({
  title,
  description,
  label,
  busy,
  error,
  onConfirm,
}: {
  title: string;
  description: string;
  label: string;
  busy: boolean;
  error: string;
  onConfirm: () => Promise<boolean>;
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
        <Button variant="secondary" disabled={busy}>
          {title}
        </Button>
      }
    >
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
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
    </Dialog>
  );
}
