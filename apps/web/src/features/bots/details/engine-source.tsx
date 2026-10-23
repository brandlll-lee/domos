import { SegmentedControl } from "@domos/ui/choice";
import { SettingRow } from "@domos/ui/setting-row";
import type { EngineSetup } from "./use-engine.ts";

export const accountSources = [
  { value: "native", label: "电脑", title: "使用所选工作电脑的 CLI 配置" },
  { value: "managed", label: "Domos", title: "使用 Domos 管理的账号和配置" },
] as const;

export function EngineSource({
  setup,
  disabled,
}: {
  setup: EngineSetup;
  disabled: boolean;
}) {
  const config = setup.profile?.config;
  return (
    <SettingRow title="账号来源">
      <SegmentedControl
        label="账号来源"
        value={config?.accountSource ?? "managed"}
        disabled={disabled || !config}
        options={accountSources}
        onValueChange={(value) => {
          if (!config) return;
          void (async () => {
            if (
              await setup.save({
                provider: config.provider,
                model: null,
                accountSource: value,
              })
            ) {
              if (value === "native") await setup.inspect();
            }
          })();
        }}
      />
    </SettingRow>
  );
}
