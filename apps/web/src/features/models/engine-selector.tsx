import type { EngineId } from "@domos/agent/harness/types";
import type { ChatView } from "@domos/agent/view";
import { ModelSelector } from "@domos/ui/model-selector";
import { useState } from "react";
import { client } from "../../client.ts";
import type { EngineSetup } from "../bots/details/use-engine.ts";
import { EngineMark } from "../bots/engine-mark.tsx";
import { userError } from "../user-error.ts";
import { modelKey, useModels } from "./use-models.ts";

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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const catalog = useModels(open && connected);
  const profile = setup.profile;
  const provider = profile?.config.provider ?? "pi";
  const selected =
    provider === "pi"
      ? (profile?.config.model ??
        (model ? `${model.provider}/${model.modelId}` : null))
      : profile?.config.model;
  const piModels = catalog.choices ?? [];
  const piSelection = piModels.find(
    (item) => `${item.provider}/${item.modelId}` === selected,
  );
  const models =
    provider === "pi"
      ? piModels.map((item) => ({
          id: modelKey(item),
          name: `${item.providerName} · ${item.name}`,
        }))
      : [
          { id: "", name: "使用引擎默认模型" },
          ...(setup.connection?.models ?? []),
        ];
  const value =
    provider === "pi"
      ? piSelection
        ? modelKey(piSelection)
        : ""
      : (selected ?? "");
  const label =
    models.find((item) => item.id === value)?.name ?? selected ?? "选择模型";
  const loading =
    saving ||
    setup.pending !== null ||
    !profile ||
    (open && provider === "pi" && catalog.choices === null && !catalog.error);
  return (
    <ModelSelector
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError("");
        if (next && provider !== "pi" && !setup.busy) void setup.inspect();
      }}
      providers={(profile?.providers ?? []).map((item) => ({
        ...item,
        icon: <EngineMark provider={item.id} />,
      }))}
      provider={provider}
      models={models}
      value={value}
      label={label}
      loading={loading}
      disabled={!connected || Boolean(setup.busy) || saving}
      error={error || setup.error || (provider === "pi" ? catalog.error : null)}
      onProviderChange={(id) => {
        if (id === provider) return;
        void (async () => {
          if (await setup.save({ provider: id as EngineId, model: null }))
            await setup.inspect();
        })();
      }}
      onSelect={(id) => {
        void (async () => {
          setSaving(true);
          setError("");
          try {
            if (provider === "pi") {
              const choice = piModels.find((item) => modelKey(item) === id);
              if (!choice) return;
              await client.models.select({
                botId,
                provider: choice.provider,
                modelId: choice.modelId,
              });
              await setup.refresh();
            } else {
              if (!(await setup.save({ provider, model: id || null }))) return;
              if (!(await setup.inspect())) return;
            }
            setOpen(false);
          } catch (cause) {
            setError(userError(cause, "模型切换失败。请重试。"));
          } finally {
            setSaving(false);
          }
        })();
      }}
      onConfigure={() => {
        setOpen(false);
        onConfigure();
      }}
    />
  );
}
