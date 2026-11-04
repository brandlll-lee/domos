import { Button } from "@domos/ui/controls";
import { useCallback, useEffect, useState } from "react";
import { client } from "../../../client.ts";
import { ComputerPermission } from "../../computer/permission.tsx";
import { ModelSetting } from "../../models/model-setting.tsx";

export function ModelSetup({
  botId,
  onBusyChange,
  onBack,
  onReady,
}: {
  botId: number;
  onBusyChange?: (busy: boolean) => void;
  onBack?: () => void;
  onReady?: () => void;
}) {
  const [profile, setProfile] =
    useState<Awaited<ReturnType<typeof client.engines.get>>>();
  const [busy, setBusy] = useState(false);
  const reportBusy = useCallback(
    (value: boolean) => {
      setBusy(value);
      onBusyChange?.(value);
    },
    [onBusyChange],
  );
  const [binding, setBinding] =
    useState<Awaited<ReturnType<typeof client.computer.get>>>();
  const [error, setError] = useState("");
  const refresh = useCallback(
    () => client.computer.get({ botId }).then(setBinding),
    [botId],
  );
  useEffect(() => {
    void refresh().catch((cause) => setError(cause.message));
  }, [refresh]);
  if (!binding)
    return <p role={error ? "alert" : "status"}>{error || "正在读取配置…"}</p>;
  if (!binding.computer?.authorized)
    return (
      <ComputerPermission
        botId={botId}
        onReady={refresh}
        onBusyChange={onBusyChange}
      />
    );
  return (
    <div className="detail-stack">
      <ModelSetting
        botId={botId}
        connected
        disabled={profile?.busy}
        onProfile={setProfile}
        onBusyChange={reportBusy}
      />
      {(onBack || onReady) && (
        <div className="dialog-actions">
          {onBack && (
            <Button variant="ghost" disabled={busy} onClick={onBack}>
              返回
            </Button>
          )}
          {onReady && (
            <Button
              disabled={busy || !(profile?.revision || profile?.prepared)}
              onClick={onReady}
            >
              开始
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
