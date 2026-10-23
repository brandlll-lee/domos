import type { EngineControls } from "@domos/agent/harness/types";
import { Button } from "@domos/ui/controls";
import { ChoicePicker } from "@domos/ui/picker";
import { SettingRow } from "@domos/ui/setting-row";
import type { EngineSetup } from "./use-engine.ts";

function EngineOption({
  setup,
  item,
}: {
  setup: EngineSetup;
  item: EngineControls["options"][number];
}) {
  const profile = setup.profile;
  if (!profile) return null;
  return (
    <SettingRow title={item.label}>
      <ChoicePicker
        label={item.label}
        size="small"
        disabled={Boolean(setup.busy) || setup.saving}
        value={profile.config.options?.[item.id] ?? item.value}
        items={[
          ...(item.value ? [] : [{ value: "", label: "引擎默认" }]),
          ...item.options.map((option) => ({
            value: option.id,
            label: option.label,
          })),
        ]}
        onValueChange={(value) => {
          const options = { ...profile.config.options };
          if (value) options[item.id] = value;
          else delete options[item.id];
          void setup.save({ ...profile.config, options });
        }}
      />
    </SettingRow>
  );
}

export function EngineReasoning({ setup }: { setup: EngineSetup }) {
  const config = setup.profile?.config;
  const effort =
    (config &&
      setup.catalog
        .models(config.provider)
        ?.find((item) => item.id === config.model)?.effort) ??
    (setup.profile?.model?.id === config?.model
      ? setup.profile?.model?.effort
      : undefined) ??
    setup.profile?.runtime?.controls?.options.find(
      (item) => item.kind === "effort" && item.options.length,
    );
  if (effort?.options.length && (setup.profile?.providers.length ?? 0) > 1)
    return <EngineOption setup={setup} item={effort} />;
  return (
    <SettingRow title="思考程度">
      <span className="detail-note">引擎默认</span>
    </SettingRow>
  );
}

export function NativeControls({ setup }: { setup: EngineSetup }) {
  const { profile, busy } = setup;
  if (!profile || profile.providers.length < 2) return null;
  const controls = profile.runtime?.controls;
  const options =
    controls?.options.filter(
      (item) => item.kind !== "effort" && item.options.length,
    ) ?? [];
  return (
    <section className="detail-stack" aria-label="原生运行配置">
      <Button
        size="small"
        variant="secondary"
        disabled={Boolean(busy) || setup.saving}
        pending={setup.pending === "controls"}
        onClick={() => void setup.controls()}
      >
        读取原生配置
      </Button>
      {!!options.length && (
        <div className="settings-card">
          {options.map((item) => (
            <EngineOption key={item.id} setup={setup} item={item} />
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
