import type { EngineId } from "@domos/agent/harness/types";
import type { ChatView } from "@domos/agent/view";
import { ModelSelector } from "@domos/ui/model-selector";
import { useEffect, useState } from "react";
import type { EngineSetup } from "../bots/details/use-engine.ts";
import { EngineMark } from "../bots/engine-mark.tsx";
import { Effort } from "./effort.tsx";

export function EngineSelector({
  setup,
  model,
  connected,
  onConfigure,
}: {
  setup: EngineSetup;
  model: ChatView["model"];
  connected: boolean;
  onConfigure: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [browsing, setBrowsing] = useState<EngineId>("pi");
  const { profile, catalog } = setup;
  const provider = profile?.config.provider ?? "pi";
  const selected =
    profile?.config.model ??
    (provider === "pi" && profile?.config.accountSource !== "native" && model
      ? `${model.provider}/${model.modelId}`
      : null);
  const visibility = catalog.visibility;
  useEffect(() => {
    if (open) void catalog.load(browsing);
  }, [open, browsing, catalog.load]);
  const models = catalog.models(browsing);
  const error = catalog.error(browsing);
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
        if (next) setBrowsing(provider);
      }}
      providers={(profile?.providers ?? []).map((item) => ({
        ...item,
        icon: <EngineMark provider={item.id} />,
      }))}
      provider={browsing}
      models={(models ?? []).filter((item) =>
        visibility.visible(browsing, item.id),
      )}
      value={browsing === provider ? (selected ?? "") : ""}
      label={
        selected
          ? `${profile?.providers.find((item) => item.id === provider)?.name ?? "Pi"} · ${active?.name ?? selected}`
          : "选择模型"
      }
      loading={!profile || (open && !models && !error)}
      disabled={!connected || Boolean(setup.busy)}
      busy={Boolean(profile?.busy)}
      error={setup.error || visibility.error || error}
      onProviderChange={(id) => setBrowsing(id as EngineId)}
      onSelect={(id) => {
        setOpen(false);
        void setup.save({ provider: browsing, model: id });
      }}
      effort={
        browsing === provider &&
        effort &&
        (profile?.providers.length ?? 0) > 1 ? (
          <Effort
            key={`${provider}:${selected}:${profile?.config.options?.[effort.id] ?? effort.value}`}
            control={{
              ...effort,
              value: profile?.config.options?.[effort.id] ?? effort.value,
            }}
            disabled={Boolean(setup.busy) || setup.saving}
            onChange={(value) => {
              if (profile)
                void setup.save({
                  ...profile.config,
                  options: { ...profile.config.options, [effort.id]: value },
                });
            }}
          />
        ) : null
      }
      onConfigure={() => {
        setOpen(false);
        onConfigure();
      }}
    />
  );
}
