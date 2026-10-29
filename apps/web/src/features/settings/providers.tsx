import { SettingRow } from "@domos/ui/setting-row";
import { ModelSetting } from "../models/model-setting.tsx";
import { useConnectionContext } from "./use-connection-context.ts";
export function ProviderSettings({ botId }: { botId?: number }) {
  const { target, error } = useConnectionContext(botId);
  return (
    <div className="settings-sections">
      {target && (
        <>
          <SettingRow title={target.name}>{target.computer}</SettingRow>
          <ModelSetting botId={target.id} connected />
        </>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
