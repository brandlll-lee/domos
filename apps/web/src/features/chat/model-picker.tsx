import type { ChatView } from "@domos/agent/view";
import { Button } from "@domos/ui/controls";
import { SearchPicker } from "@domos/ui/picker";
import { useState } from "react";
import { client } from "../../client.ts";
import { useHosting } from "../hosting/root.tsx";
import { modelItems, modelKey, useModels } from "../models/use-models.ts";
import { rejectionMessage } from "./request-error.ts";

export function ModelPicker({
  botId,
  model,
  connected,
}: {
  botId: number;
  model: ChatView["model"];
  connected: boolean;
}) {
  const settings = useHosting();
  const { choices, error: catalogError } = useModels(connected);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = model ? modelKey(model) : "";
  return (
    <div className="model-picker">
      <SearchPicker
        label="模型"
        searchLabel="搜索模型…"
        emptyLabel="没有找到模型"
        placeholder={
          model
            ? `${model.provider} / ${model.modelId}${choices === null ? "" : "（未配置）"}`
            : "稍后连接"
        }
        items={modelItems(choices)}
        value={selected}
        disabled={!connected || choices === null}
        readOnly={saving}
        onValueChange={async (value) => {
          const choice = choices?.find((item) => modelKey(item) === value);
          if (!choice) return;
          setSaving(true);
          setError(null);
          try {
            await client.models.select({
              botId,
              provider: choice.provider,
              modelId: choice.modelId,
            });
          } catch (cause) {
            setError(rejectionMessage(cause) ?? "模型切换失败。请重试。");
          } finally {
            setSaving(false);
          }
        }}
      />
      <span
        className={saving || choices?.length === 0 ? "model-help" : "sr-only"}
        role="status"
      >
        {saving
          ? "正在保存…"
          : choices?.length === 0
            ? "连接模型后即可聊天。"
            : "所选模型用于下一次回复。"}
      </span>
      <Button variant="ghost" onClick={() => settings.open("models", botId)}>
        连接模型
      </Button>
      {(error ?? catalogError) && (
        <p className="alert" role="alert">
          {error ?? catalogError}
        </p>
      )}
    </div>
  );
}
