import { TextField } from "@domos/ui/field";
import { ScrollArea } from "@domos/ui/scroll-area";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { useState } from "react";
import { HostingModels } from "../../hosting/models.tsx";
import { ModelSetting } from "../../models/model-setting.tsx";
import { useSettings } from "../../settings/context.ts";
import type { EngineSetup } from "./use-engine.ts";

export function PiEngineModel({
  botId,
  setup,
  canManage,
  onBusyChange,
  onSelected,
}: {
  botId: number;
  setup: EngineSetup;
  canManage: boolean;
  onBusyChange: (busy: boolean) => void;
  onSelected: () => void;
}) {
  const settings = useSettings();
  const model = setup.profile?.config.model;
  const separator = model?.indexOf("/") ?? -1;
  const selection =
    model && separator > 0
      ? {
          provider: model.slice(0, separator),
          modelId: model.slice(separator + 1),
        }
      : null;
  const configured = async () => {
    if (settings.standalone) {
      await setup.refresh();
      onSelected();
      return;
    }
    if (await setup.inspect()) onSelected();
  };
  if (canManage && !settings.standalone)
    return (
      <HostingModels
        botId={botId}
        model={model}
        onConfigured={configured}
        onBusyChange={onBusyChange}
      />
    );
  return (
    <div className="settings-card">
      <ModelSetting
        botId={botId}
        model={selection}
        connected={Boolean(setup.profile)}
        disabled={Boolean(setup.busy)}
        onSelected={configured}
        onBusyChange={onBusyChange}
      />
    </div>
  );
}

export function EngineModel({
  setup,
  onSelected,
}: {
  setup: EngineSetup;
  onSelected: () => void;
}) {
  const [query, setQuery] = useState("");
  const { profile, connection, busy } = setup;
  if (!profile) return null;
  const models = [
    { id: "", name: "使用引擎默认模型" },
    ...(connection?.models ?? []),
  ].filter((item) =>
    `${item.name} ${item.id}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const choose = async (id: string) => {
    if (
      await setup.save({ provider: profile.config.provider, model: id || null })
    ) {
      onSelected();
    }
  };
  return (
    <div className="engine-model-list">
      <TextField
        label="搜索模型"
        type="search"
        placeholder="输入模型名称"
        value={query}
        onValueChange={setQuery}
        disabled={busy}
      />
      <ScrollArea className="engine-model-scroll">
        <fieldset className="engine-model-options" aria-label="可用模型">
          {models.map((item) => (
            <button
              type="button"
              key={item.id}
              className="engine-model-option"
              disabled={busy}
              aria-pressed={item.id === (profile.config.model ?? "")}
              onClick={() => void choose(item.id)}
            >
              <span>{item.name}</span>
              {item.id === (profile.config.model ?? "") && (
                <CheckIcon size={16} aria-hidden="true" />
              )}
            </button>
          ))}
          {!models.length && <p className="detail-note">没有找到模型。</p>}
        </fieldset>
      </ScrollArea>
    </div>
  );
}
