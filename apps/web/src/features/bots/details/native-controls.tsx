import { Button } from "@domos/ui/controls";
import { ChoicePicker } from "@domos/ui/picker";
import { SettingRow } from "@domos/ui/setting-row";
import type { EngineSetup } from "./use-engine.ts";

export function NativeControls({ setup }: { setup: EngineSetup }) {
  const { profile, busy } = setup;
  if (!profile || profile.providers.length < 2) return null;
  const controls = profile.runtime?.controls;
  return (
    <section className="detail-stack" aria-label="原生运行配置">
      <Button
        size="small"
        variant="secondary"
        disabled={busy}
        pending={setup.pending === "controls"}
        onClick={() => void setup.controls()}
      >
        读取原生配置
      </Button>
      {controls && (
        <div className="settings-card">
          {controls.options
            .filter((item) => item.options.length)
            .map((item) => (
              <SettingRow key={item.id} title={item.label}>
                <ChoicePicker
                  label={item.label}
                  size="small"
                  disabled={busy}
                  value={profile.config.options?.[item.id] ?? item.value}
                  items={[
                    ...(item.value ? [] : [{ value: "", label: "引擎默认" }]),
                    ...item.options.map((option) => ({
                      value: option.id,
                      label: option.label,
                    })),
                  ]}
                  onValueChange={(value) => {
                    if (!value) return;
                    const options = {
                      ...profile.config.options,
                      [item.id]: value,
                    };
                    void setup.save({ ...profile.config, options });
                  }}
                />
              </SettingRow>
            ))}
        </div>
      )}
      {!!controls?.commands.length && (
        <details>
          <summary>原生命令与扩展</summary>
          <dl>
            {controls.commands.map((command) => (
              <div key={command.name}>
                <dt>/{command.name}</dt>
                <dd className="detail-note">{command.description}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {!!profile.runtime?.integrations?.length && (
        <details>
          <summary>工具连接</summary>
          {profile.runtime.integrations.map((item) => (
            <p key={item.name}>
              {item.name} · {item.status}
            </p>
          ))}
        </details>
      )}
      {!!profile.runtime?.skills?.length && (
        <p className="detail-note">
          原生技能：{profile.runtime.skills.join("、")}
        </p>
      )}
    </section>
  );
}
