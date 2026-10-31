import { Button } from "@domos/ui/controls";
import { useCallback, useState } from "react";
import type { client } from "../../../client.ts";
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
