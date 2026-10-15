import type { ChatView } from "@domos/agent/view";
import { SearchPicker } from "@domos/ui/picker";
import { useEffect, useState } from "react";
import { client } from "../../client.ts";
import { rejectionMessage } from "./request-error.ts";

type Choice = Awaited<ReturnType<typeof client.models.list>>[number];
const key = (model: { provider: string; modelId: string }) =>
  JSON.stringify([model.provider, model.modelId]);

export function ModelPicker({
  model,
  connected,
}: {
  model: ChatView["model"];
  connected: boolean;
}) {
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    void client.models
      .list(undefined, { signal: controller.signal })
      .then((next) => {
        if (!controller.signal.aborted) {
          setChoices(next);
          setError(null);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("模型目录加载失败。请刷新重试。");
      });
    return () => controller.abort();
  }, [connected]);
  const selected = model ? key(model) : "";
  return (
    <div className="model-picker">
      <SearchPicker
        label="模型"
        searchLabel="搜索模型…"
        emptyLabel="没有找到模型"
        placeholder={
          model
            ? `${model.provider} / ${model.modelId}${choices === null ? "" : "（未配置）"}`
            : "正在加载…"
        }
        items={
          choices?.map((choice) => ({
            value: key(choice),
            label: `${choice.providerName} · ${choice.name}`,
          })) ?? []
        }
        value={selected}
        disabled={!connected || choices === null}
        readOnly={saving}
        onValueChange={async (value) => {
          const choice = choices?.find((item) => key(item) === value);
          if (!choice) return;
          setSaving(true);
          setError(null);
          try {
            await client.models.select({
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
            ? "请配置服务商凭据后重启服务。"
            : "所选模型用于下一次回复。"}
      </span>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
