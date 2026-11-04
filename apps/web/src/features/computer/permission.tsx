import { Button } from "@domos/ui/controls";
import { useRef, useState } from "react";
import { client } from "../../client.ts";

export function ComputerPermission({
  botId,
  onReady,
  onBusyChange,
}: {
  botId: number;
  onReady: () => Promise<unknown>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const request = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="detail-stack">
      <p>机器人已归属这台电脑。使用模型和工具前，请允许访问文件与命令。</p>
      <p className="detail-note">
        授权会应用到使用同一环境的机器人。命令使用 Domos
        的系统权限。工作目录不提供安全隔离。
      </p>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <Button
          pending={busy}
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            onBusyChange?.(true);
            setError("");
            try {
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
                  requestId: request.current,
                });
              await onReady();
            } catch (cause) {
              setError(
                cause instanceof Error ? cause.message : "授权未确认。请重试。",
              );
            } finally {
              setBusy(false);
              onBusyChange?.(false);
            }
          }}
        >
          允许访问并继续
        </Button>
      </div>
    </div>
  );
}
