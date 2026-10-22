import { ChoicePicker } from "@domos/ui/picker";
import { SettingRow } from "@domos/ui/setting-row";
import type { EngineSetup } from "./use-engine.ts";

export function EngineSource({
  setup,
  disabled,
}: {
  setup: EngineSetup;
  disabled: boolean;
}) {
  const config = setup.profile?.config;
  return (
    <SettingRow
      title="账号来源"
      description={
        config?.accountSource === "native"
          ? "读取所选工作电脑当前运行用户的账号和模型。账号由原 CLI 管理。"
          : undefined
      }
    >
      <ChoicePicker
        label="账号来源"
        value={config?.accountSource ?? "managed"}
        disabled={disabled || !config}
        items={[
          { value: "managed", label: "Domos 管理" },
          { value: "native", label: "工作电脑已有配置" },
        ]}
        onValueChange={(value) => {
          if (!config || (value !== "native" && value !== "managed")) return;
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
