import type {
  EngineConfig,
  EngineId,
  EngineModel,
} from "@domos/agent/harness/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { client } from "../../../client.ts";
import { useModels } from "../../models/use-models.ts";
import { useVisibility } from "../../models/use-visibility.ts";
import { userError } from "../../user-error.ts";

export function useEngineCatalog(
  botId: number,
  active: boolean,
  config: EngineConfig | undefined,
  computerId?: string,
) {
  const managed = useModels(active);
  const visibility = useVisibility(active);
  const [native, setNative] = useState<Record<string, EngineModel[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const pending = useRef(new Map<string, Promise<void>>());
  const generation = useRef(0);
  const scope = useRef({ botId, computerId });
  const invalidate = useCallback(() => {
    generation.current++;
    pending.current.clear();
    setNative({});
    setErrors({});
  }, []);
  useEffect(() => {
    if (
      scope.current.botId !== botId ||
      scope.current.computerId !== computerId
    ) {
      scope.current = { botId, computerId };
      invalidate();
    }
  }, [botId, computerId, invalidate]);
  useEffect(() => {
    window.addEventListener("domos:engines", invalidate);
    return () => window.removeEventListener("domos:engines", invalidate);
  }, [invalidate]);
  const key = (provider: EngineId) =>
    `${provider}:${provider === config?.provider ? (config.accountSource ?? "managed") : "managed"}`;
  const managedModels = useMemo(
    () =>
      managed.choices?.map((item) => ({
        id: `${item.provider}/${item.modelId}`,
        name: item.name,
        group: item.providerName,
      })),
    [managed.choices],
  );
  const models = (provider: EngineId) =>
    key(provider) === "pi:managed" ? managedModels : native[key(provider)];
  return {
    models,
    visibility,
    error: (provider: EngineId) =>
      key(provider) === "pi:managed" ? managed.error : errors[key(provider)],
    load(provider: EngineId) {
      const id = key(provider);
      if (id === "pi:managed" || native[id]) return Promise.resolve();
      const existing = pending.current.get(id);
      if (existing) return existing;
      const version = generation.current;
      const request = client.engines
        .inspect({ botId, provider })
        .then(
          (result) => {
            if (version === generation.current) {
              setNative((current) => ({ ...current, [id]: result.models }));
              setErrors((current) => ({ ...current, [id]: "" }));
            }
          },
          (cause) => {
            if (version === generation.current) {
              setNative((current) => ({ ...current, [id]: [] }));
              setErrors((current) => ({
                ...current,
                [id]: userError(cause, "模型读取失败。请重试。"),
              }));
            }
          },
        )
        .finally(() => {
          if (pending.current.get(id) === request) pending.current.delete(id);
        });
      pending.current.set(id, request);
      return request;
    },
  };
}
