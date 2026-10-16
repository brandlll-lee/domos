import { useEffect, useState } from "react";
import { client } from "../../client.ts";

export type ModelChoice = Awaited<
  ReturnType<typeof client.models.list>
>[number];
export const modelKey = (model: { provider: string; modelId: string }) =>
  JSON.stringify([model.provider, model.modelId]);
export const modelItems = (choices: ModelChoice[] | null) =>
  choices?.map((choice) => ({
    value: modelKey(choice),
    label: `${choice.providerName} · ${choice.name}`,
  })) ?? [];

export function useModels(enabled: boolean) {
  const [choices, setChoices] = useState<ModelChoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const refresh = () => {
      void client.models.list(undefined, { signal: controller.signal }).then(
        (next) => {
          if (!controller.signal.aborted) {
            setChoices(next);
            setError(null);
          }
        },
        () => {
          if (!controller.signal.aborted)
            setError("模型目录加载失败。请刷新重试。");
        },
      );
    };
    refresh();
    window.addEventListener("domos:models", refresh);
    return () => {
      controller.abort();
      window.removeEventListener("domos:models", refresh);
    };
  }, [enabled]);
  return { choices, error };
}
