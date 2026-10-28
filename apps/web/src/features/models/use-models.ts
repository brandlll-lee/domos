import { useCallback, useEffect, useState } from "react";
import { client } from "../../client.ts";

export type ModelChoice = Awaited<
  ReturnType<typeof client.models.list>
>[number];
export const modelKey = (model: { provider: string; modelId: string }) =>
  JSON.stringify([model.provider, model.modelId]);

export function useModels(enabled: boolean) {
  const [choices, setChoices] = useState<ModelChoice[] | null>(null);
  const [providers, setProviders] = useState<
    Awaited<ReturnType<typeof client.models.providers>>
  >([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const refresh = () => {
      void Promise.all([
        client.models.list(undefined, { signal: controller.signal }),
        client.models.providers(undefined, { signal: controller.signal }),
      ]).then(
        ([next, providers]) => {
          if (!controller.signal.aborted) {
            setChoices(next);
            setProviders(providers);
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
  const refreshProvider = useCallback(
    async (provider: string, signal: AbortSignal) => {
      const next = await client.models.refresh({ provider }, { signal });
      if (!signal.aborted) setChoices(next);
    },
    [],
  );
  return { choices, providers, error, refreshProvider };
}
