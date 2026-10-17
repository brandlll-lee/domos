import type { ChatView } from "@domos/agent/view";
import { Button } from "@domos/ui/controls";
import { SearchPicker } from "@domos/ui/picker";
import { SettingRow } from "@domos/ui/setting-row";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { useState } from "react";
import { client } from "../../client.ts";
import { modelItems, modelKey, useModels } from "../models/use-models.ts";
import { useSettings } from "../settings/context.ts";
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
  const settings = useSettings();
  const { choices, error: catalogError } = useModels(connected);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = model ? modelKey(model) : "";
  return (
    <section className="settings-group" aria-label="模型设置">
      <h3>模型</h3>
      <div className="settings-card">
        <SettingRow
          title="对话模型"
          description={
            <span role="status">
              {saving
                ? "正在保存…"
                : choices?.length === 0
                  ? "连接后即可聊天。"
                  : "用于下一次回复。"}
            </span>
          }
        >
          <SearchPicker
            label="模型"
            size="small"
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
        </SettingRow>
        <SettingRow title="模型账号" description="在设置中管理连接。">
          <Button
            variant="secondary"
            size="small"
            onClick={() => settings.open("models", botId)}
          >
            连接模型
            <ArrowUpRightIcon size={14} />
          </Button>
        </SettingRow>
      </div>
      {(error ?? catalogError) && (
        <p className="alert" role="alert">
          {error ?? catalogError}
        </p>
      )}
    </section>
  );
}
