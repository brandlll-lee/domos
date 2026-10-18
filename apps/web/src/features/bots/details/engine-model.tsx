import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { SearchPicker } from "@domos/ui/picker";
import { useState } from "react";
import { ModelPicker } from "../../chat/model-picker.tsx";
import { HostingModels } from "../../hosting/models.tsx";
import { useSettings } from "../../settings/context.ts";
import type { EngineSetup } from "./use-engine.ts";

export function PiEngineModel({
  botId,
  setup,
  canManage,
  onBusyChange,
  formId,
}: {
  botId: number;
  setup: EngineSetup;
  canManage: boolean;
  onBusyChange: (busy: boolean) => void;
  formId?: string;
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
  if (canManage && !settings.standalone)
    return (
      <HostingModels
        botId={botId}
        model={model}
        formId={formId}
        onConfigured={() => void setup.refresh()}
        onBusyChange={onBusyChange}
      />
    );
  return (
    <ModelPicker
      botId={botId}
      model={selection}
      connected={Boolean(setup.profile)}
      onSelected={setup.refresh}
      onBusyChange={onBusyChange}
    />
  );
}

export function EngineModel({ setup }: { setup: EngineSetup }) {
  const { profile, connection, busy } = setup;
  const [model, setModel] = useState(profile?.config.model ?? "");
  if (!profile) return null;
  return (
    <form
      className="detail-stack"
      onSubmit={(event) => {
        event.preventDefault();
        void setup.save({
          provider: profile.config.provider,
          model: model.trim() || null,
        });
      }}
    >
      {connection?.models.length ? (
        <SearchPicker
          label="引擎模型"
          value={model}
          searchLabel="搜索模型…"
          emptyLabel="没有找到模型"
          placeholder="使用引擎默认模型"
          items={[
            { value: "", label: "使用引擎默认模型" },
            ...connection.models.map(({ id, name }) => ({
              value: id,
              label: name,
            })),
          ]}
          disabled={busy}
          onValueChange={setModel}
        />
      ) : (
        <TextField
          label="模型（可选）"
          value={model}
          onValueChange={setModel}
          disabled={busy}
          placeholder="留空使用引擎默认模型"
        />
      )}
      <div className="form-actions">
        <Button
          disabled={busy || model === (profile.config.model ?? "")}
          pending={setup.pending === "configure"}
        >
          保存模型
        </Button>
      </div>
    </form>
  );
}
