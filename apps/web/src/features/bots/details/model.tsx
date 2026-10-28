import { Button } from "@domos/ui/controls";
import { useCallback, useEffect, useState } from "react";
import { client } from "../../../client.ts";
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const reportBusy = useCallback(
    (value: boolean) => {
      setBusy(value);
      onBusyChange?.(value);
    },
    [onBusyChange],
  );
  const refresh = () => client.engines.get({ botId }).then(setProfile);
  useEffect(() => {
    void client.engines
      .get({ botId })
      .then(setProfile, (cause) => setError(cause.message));
  }, [botId]);
  return (
    <div className="detail-stack">
      <ModelSetting
        botId={botId}
        model={null}
        connected={Boolean(profile)}
        disabled={profile?.busy}
        onSelected={refresh}
        onBusyChange={reportBusy}
      />
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      {(onBack || onReady) && (
        <div className="dialog-actions">
          {onBack && (
            <Button variant="ghost" disabled={busy} onClick={onBack}>
              返回
            </Button>
          )}
          {onReady && (
            <Button disabled={busy || !profile?.prepared} onClick={onReady}>
              开始
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
