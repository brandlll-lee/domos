import type { ChatView } from "@domos/agent/view";
import { useEffect, useState } from "react";
import { client } from "../../client.ts";
import { Select } from "../../ui/controls.tsx";
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
  const configured =
    choices?.some((choice) => key(choice) === selected) ?? false;
  return (
    <div className="model-picker">
      <label className="sr-only" htmlFor="model">
        模型
      </label>
      <Select
        id="model"
        name="model"
        title="所选模型用于下一次回复"
        value={selected}
        disabled={!connected || choices === null || saving}
        onChange={async (event) => {
          const choice = choices?.find(
            (item) => key(item) === event.target.value,
          );
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
      >
        {!configured && (
          <option value={selected} disabled>
            {model
              ? `${model.provider} / ${model.modelId}${choices === null ? "" : "（未配置）"}`
              : "正在加载…"}
          </option>
        )}
        {choices?.map((choice) => (
          <option key={key(choice)} value={key(choice)}>
            {choice.providerName} · {choice.name}
          </option>
        ))}
      </Select>
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
