import { Button } from "@domos/ui/controls";
import { SettingRow } from "@domos/ui/setting-row";
import { useCallback, useEffect, useState } from "react";
import { client } from "../../../client.ts";
import { HostingModels } from "../../hosting/models.tsx";
import { Effort } from "../../models/effort.tsx";
import { ModelSetting } from "../../models/model-setting.tsx";
import { useSettings } from "../../settings/context.ts";

export function ModelSetup({
  botId,
  canManage,
  onBusyChange,
  onBack,
  onReady,
}: {
  botId: number;
  canManage: boolean;
  onBusyChange?: (busy: boolean) => void;
  onBack?: () => void;
  onReady?: () => void;
}) {
  const settings = useSettings();
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
  const model = profile?.config.model;
  const separator = model?.indexOf("/") ?? -1;
  return (
    <div className="detail-stack">
      {canManage && !settings.standalone ? (
        <HostingModels
          botId={botId}
          model={model}
          onBusyChange={reportBusy}
          onConfigured={refresh}
        />
      ) : (
        <ModelSetting
          botId={botId}
          model={
            model && separator > 0
              ? {
                  provider: model.slice(0, separator),
                  modelId: model.slice(separator + 1),
                }
              : null
          }
          connected={Boolean(profile)}
          onSelected={refresh}
          onBusyChange={reportBusy}
        />
      )}
      {profile?.model?.effort && (
        <SettingRow title="推理强度">
          <Effort
            control={{
              ...profile.model.effort,
              value: profile.config.options.thinkingLevel,
            }}
            disabled={profile.busy}
            onChange={(thinkingLevel) => {
              void client.models
                .thinking({ botId, thinkingLevel })
                .then(refresh, (cause) => setError(cause.message));
            }}
          />
        </SettingRow>
      )}
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
