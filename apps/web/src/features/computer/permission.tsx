import { Button } from "@domos/ui/controls";
import { DialogFooter } from "@domos/ui/dialog";
import { SetupComputer } from "@domos/ui/setup";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { client } from "../../client.ts";

export async function authorizeComputer(botId: number, requestId: string) {
  const binding = await client.computer.get({ botId });
  if (binding.computerId)
    await client.computer.authorize({
      id: binding.computerId,
      authorized: true,
    });
  else
    await client.computer.configure({
      botId,
      mode: "process",
      revision: binding.revision,
      requestId,
    });
}

export function ComputerPermission({
  botId,
  onReady,
  onBusyChange,
  footer,
}: {
  botId: number;
  onReady: () => Promise<unknown>;
  onBusyChange?: (busy: boolean) => void;
  footer?: ReactNode;
}) {
  const request = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [computer, setComputer] = useState("");
  useEffect(() => {
    void client.computer.get({ botId }).then(
      (binding) => setComputer(binding.computer?.name ?? "Bot 所属电脑"),
      (cause) => setError(cause.message),
    );
  }, [botId]);
  return (
    <div className="setup-permission">
      <SetupComputer />
      <p className="setup-permission-title">
        允许 Domos 运行本机程序并访问文件
      </p>
      <p className="detail-note">
        授权对象：{computer || "正在读取…"}。此授权适用于共用该环境的机器人。
        程序与文件访问使用该电脑上 Domos 的系统权限，范围不限于工作目录。
      </p>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <DialogFooter>
        <div className="setup-actions">
          <Button
            variant="primary"
            pending={busy}
            disabled={!computer}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              onBusyChange?.(true);
              setError("");
              try {
                await authorizeComputer(botId, request.current);
                await onReady();
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "授权未确认。请重试。",
                );
              } finally {
                setBusy(false);
                onBusyChange?.(false);
              }
            }}
          >
            允许访问并继续
          </Button>
          {footer}
        </div>
      </DialogFooter>
    </div>
  );
}
