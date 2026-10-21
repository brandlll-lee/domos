import type { EngineId, EngineModel } from "@domos/agent/harness/types";
import type { ChatView } from "@domos/agent/view";
import { ModelSelector } from "@domos/ui/model-selector";
import { useEffect, useEffectEvent, useState } from "react";
import { client } from "../../client.ts";
import type { EngineSetup } from "../bots/details/use-engine.ts";
import { EngineMark } from "../bots/engine-mark.tsx";
import { userError } from "../user-error.ts";
import { Effort } from "./effort.tsx";
import { useModels } from "./use-models.ts";
import { useVisibility } from "./use-visibility.ts";

export function EngineSelector({
  botId,
  setup,
  model,
  connected,
  onConfigure,
}: {
  botId: number;
  setup: EngineSetup;
  model: ChatView["model"];
  connected: boolean;
  onConfigure: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [browsing, setBrowsing] = useState<EngineId>("pi");
  const [scope, setScope] = useState(botId);
  const [native, setNative] = useState<
    Partial<Record<EngineId, EngineModel[]>>
  >({});
  if (scope !== botId) {
    setScope(botId);
    setNative({});
  }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const catalog = useModels(connected);
  const visibility = useVisibility(connected);
  const profile = setup.profile;
  const provider = profile?.config.provider ?? "pi";
  const selected =
    profile?.config.model ??
    (provider === "pi" && model ? `${model.provider}/${model.modelId}` : null);
  const [selectionLabel, setSelectionLabel] = useState<{
    id: string;
    name: string;
  }>();
  const readControls = useEffectEvent(() => {
    if (!setup.busy && !profile?.runtime?.controls) void setup.controls();
  });
  useEffect(() => {
    if (!open) return;
    if (browsing === provider) readControls();
    if (browsing === "pi" || native[browsing]) return;
    let current = true;
    setError("");
    void client.engines.inspect({ botId, provider: browsing }).then(
      (result) => {
        if (!current) return;
        setNative((current) => ({ ...current, [browsing]: result.models }));
        const active = result.models.find((item) => item.id === selected);
        if (browsing === provider && active) setSelectionLabel(active);
      },
      (cause) => {
        if (current) {
          setNative((current) => ({ ...current, [browsing]: [] }));
          setError(userError(cause, "模型读取失败。请重试。"));
        }
      },
    );
    return () => {
      current = false;
    };
  }, [open, browsing, botId, provider, selected, native]);
  useEffect(() => {
    const refresh = () => setNative({});
    window.addEventListener("domos:engines", refresh);
    return () => window.removeEventListener("domos:engines", refresh);
  }, []);
  const models =
    browsing === "pi"
      ? (catalog.choices ?? []).map((item) => ({
          id: `${item.provider}/${item.modelId}`,
          name: item.name,
          group: item.providerName,
        }))
      : (native[browsing] ?? []);
  const piSelected = catalog.choices?.find(
    (item) => `${item.provider}/${item.modelId}` === selected,
  );
  const label =
    provider === "pi" && piSelected
      ? `${piSelected.providerName} · ${piSelected.name}`
      : selectionLabel?.id === selected
        ? selectionLabel.name
        : (selected ?? "选择模型");
  const effort = profile?.runtime?.controls?.options.find(
    (item) => item.kind === "effort" && item.options.length > 1,
  );
  return (
    <ModelSelector
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError("");
        if (next) {
          setBrowsing(provider);
        }
      }}
      providers={(profile?.providers ?? []).map((item) => ({
        ...item,
        icon: <EngineMark provider={item.id} />,
      }))}
      provider={browsing}
      selectedProvider={provider}
      models={models.filter((item) => visibility.visible(browsing, item.id))}
      value={browsing === provider ? (selected ?? "") : ""}
      label={label}
      loading={
        saving ||
        !profile ||
        (open &&
          (browsing === "pi"
            ? catalog.choices === null && !catalog.error
            : !native[browsing]))
      }
      disabled={!connected || Boolean(setup.busy) || saving}
      busy={Boolean(profile?.busy)}
      error={
        error ||
        setup.error ||
        visibility.error ||
        (browsing === "pi" ? catalog.error : null)
      }
      onProviderChange={(id) => {
        setBrowsing(id as EngineId);
      }}
      onSelect={(id) => {
        void (async () => {
          setSaving(true);
          setError("");
          try {
            if (browsing === "pi") {
              const choice = catalog.choices?.find(
                (item) => `${item.provider}/${item.modelId}` === id,
              );
              if (!choice) return;
              await client.models.select({
                botId,
                provider: choice.provider,
                modelId: choice.modelId,
              });
              await setup.refresh();
            } else {
              if (!(await setup.save({ provider: browsing, model: id })))
                return;
            }
            setSelectionLabel(models.find((item) => item.id === id));
            setOpen(false);
          } catch (cause) {
            setError(userError(cause, "模型切换失败。请重试。"));
          } finally {
            setSaving(false);
          }
        })();
      }}
      effort={
        browsing === provider && effort ? (
          <Effort
            key={`${provider}:${selected}:${effort.value}`}
            control={effort}
            disabled={Boolean(setup.busy) || saving}
            onChange={(value) => {
              if (!profile) return;
              void (async () => {
                setSaving(true);
                try {
                  await setup.save({
                    ...profile.config,
                    options: {
                      ...profile.config.options,
                      [effort.id]: value,
                    },
                  });
                } finally {
                  setSaving(false);
                }
              })();
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
