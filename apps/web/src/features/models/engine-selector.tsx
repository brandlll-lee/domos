import type { EngineConfig, EngineId } from "@domos/agent/harness/types";
import type { ChatView } from "@domos/agent/view";
import { SegmentedControl } from "@domos/ui/choice";
import { ModelSelector } from "@domos/ui/model-selector";
import { useEffect, useState } from "react";
import { accountSources } from "../bots/details/engine-source.tsx";
import type { EngineSetup } from "../bots/details/use-engine.ts";
import { EngineMark } from "../bots/engine-mark.tsx";
import { Effort } from "./effort.tsx";

export function EngineSelector({
  setup,
  model,
  connected,
  computerName,
  onConfigure,
}: {
  setup: EngineSetup;
  model: ChatView["model"];
  connected: boolean;
  computerName?: string;
  onConfigure: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [browsing, setBrowsing] = useState<EngineId>("pi");
  const [source, setSource] =
    useState<NonNullable<EngineConfig["accountSource"]>>("managed");
  const { profile, catalog } = setup;
  const provider = profile?.config.provider ?? "pi";
  const selected =
    profile?.config.model ??
    (provider === "pi" && profile?.config.accountSource !== "native" && model
      ? `${model.provider}/${model.modelId}`
      : null);
  const visibility = catalog.visibility;
  useEffect(() => {
    if (open) void catalog.load(browsing, source);
  }, [open, browsing, source, catalog.load]);
  const models = catalog.models(browsing, source);
  const error = catalog.error(browsing, source);
  const current =
    browsing === provider &&
    source === (profile?.config.accountSource ?? "managed");
  const active =
    catalog.models(provider)?.find((item) => item.id === selected) ??
    (profile?.model?.id === selected ? profile.model : null);
  const effort =
    active?.effort ??
    profile?.runtime?.controls?.options.find(
      (item) => item.kind === "effort" && item.options.length > 1,
    );
  return (
    <ModelSelector
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setBrowsing(provider);
          setSource(profile?.config.accountSource ?? "managed");
        }
      }}
      providers={(profile?.providers ?? []).map((item) => ({
        ...item,
        icon: <EngineMark provider={item.id} />,
      }))}
      provider={browsing}
      environment={[catalog.version(browsing, source), computerName]
        .filter(Boolean)
        .join(" · ")}
      source={
        (profile?.providers.length ?? 0) > 1 ? (
          <SegmentedControl
            label="账号来源"
            value={source}
            onValueChange={setSource}
            options={accountSources}
          />
        ) : null
      }
      models={(models ?? []).filter((item) =>
        visibility.visible(browsing, item.id),
      )}
      value={current ? (selected ?? "") : ""}
      label={
        selected
          ? `${profile?.providers.find((item) => item.id === provider)?.name ?? "Pi"} · ${active?.name ?? selected}`
          : "选择模型"
      }
      loading={!profile || (open && !models && !error)}
      disabled={!connected || Boolean(setup.busy)}
      busy={Boolean(profile?.busy)}
      error={setup.error || visibility.error || error}
      onProviderChange={(id) => {
        setBrowsing(id as EngineId);
        setSource(
          id === provider
            ? (profile?.config.accountSource ?? "managed")
            : "managed",
        );
      }}
      onSelect={(id) => {
        setOpen(false);
        void setup.save({
          provider: browsing,
          accountSource: source,
          model: id,
        });
      }}
      effort={
        current && effort && (profile?.providers.length ?? 0) > 1 ? (
          <Effort
            control={{
              ...effort,
              value: profile?.config.options?.[effort.id] ?? "",
            }}
            disabled={Boolean(setup.busy) || setup.saving}
            onChange={(value) => {
              if (profile) {
                const options = { ...profile.config.options };
                if (value) options[effort.id] = value;
                else delete options[effort.id];
                void setup.save({
                  ...profile.config,
                  options,
                });
              }
            }}
          />
        ) : null
      }
      onConfigure={async () => {
        if (setup.busy || profile?.busy) return;
        if (
          !current &&
          !(await setup.save({
            provider: browsing,
            accountSource: source,
            model: null,
          }))
        )
          return;
        setOpen(false);
        onConfigure();
      }}
    />
  );
}
