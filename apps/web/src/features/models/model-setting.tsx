import type { ChatView } from "@domos/agent/view";
import { Button } from "@domos/ui/controls";
import { SearchPicker } from "@domos/ui/picker";
import { SettingRow } from "@domos/ui/setting-row";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { useEffect, useState } from "react";
import { client } from "../../client.ts";
import { rejectionMessage } from "../chat/request-error.ts";
import { useSettings } from "../settings/context.ts";
import { modelItems, modelKey, useModels } from "./use-models.ts";

export function ModelSetting({
  botId,
  model,
  connected,
  disabled,
  onSelected,
  onBusyChange,
}: {
  botId: number;
  model: ChatView["model"];
  connected: boolean;
  disabled?: boolean;
  onSelected?: () => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const settings = useSettings();
  const { choices, error: catalogError } = useModels(connected);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => onBusyChange?.(saving), [saving, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  const selected = model ? modelKey(model) : "";
  return (
    <>
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
          disabled={disabled || !connected || choices === null}
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
              await onSelected?.();
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
      {(error ?? catalogError) && (
        <p className="alert" role="alert">
          {error ?? catalogError}
        </p>
      )}
    </>
  );
}
