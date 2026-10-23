import type {
  EngineConfig,
  EngineId,
  EngineModel,
} from "@domos/agent/harness/types";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
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
  const warmed = useRef(new Set<string>());
  const generation = useRef(0);
  const scope = useRef({ botId, computerId });
  const invalidate = useCallback(() => {
    generation.current++;
    pending.current.clear();
    warmed.current.clear();
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
  const key = (provider: EngineId) =>
    `${provider}:${provider === config?.provider ? (config.accountSource ?? "managed") : "managed"}`;
  const managedModels = useMemo(
    () =>
      managed.choices?.map((item) => ({
        id: `${item.provider}/${item.modelId}`,
        name: item.name,
        group: item.providerName,
        effort: item.effort,
      })),
    [managed.choices],
  );
  const models = (provider: EngineId) =>
    key(provider) === "pi:managed" ? managedModels : native[key(provider)];
  const load = (provider: EngineId, refresh = false) => {
    const id = key(provider);
    if (id === "pi:managed" || (!refresh && native[id]))
      return Promise.resolve();
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
            setNative((current) => ({ ...current, [id]: current[id] ?? [] }));
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
  };
  const hydrate = useEffectEvent(async () => {
    const version = generation.current;
    try {
      const catalogs = await client.engines.models({ botId });
      if (version !== generation.current) return;
      setNative((current) => ({
        ...current,
        ...Object.fromEntries(
          catalogs
            .filter((item) => item.models.length)
            .map((item) => [key(item.id), item.models]),
        ),
      }));
      for (const item of catalogs) {
        const id = key(item.id);
        if (warmed.current.has(id)) continue;
        void load(item.id, true).then(() => {
          if (version === generation.current) warmed.current.add(id);
        });
      }
    } catch (cause) {
      if (version === generation.current && config)
        setErrors((current) => ({
          ...current,
          [key(config.provider)]: userError(cause, "模型读取失败。请重试。"),
        }));
    }
  });
  const source =
    config &&
    JSON.stringify([
      botId,
      computerId,
      config.provider,
      config.accountSource ?? "managed",
    ]);
  useEffect(() => {
    if (!active || !source) return;
    void hydrate();
    const refresh = () => {
      generation.current++;
      pending.current.clear();
      warmed.current.clear();
      void hydrate();
    };
    window.addEventListener("domos:engines", refresh);
    return () => {
      generation.current++;
      pending.current.clear();
      window.removeEventListener("domos:engines", refresh);
    };
  }, [active, source]);
  return {
    models,
    visibility,
    error: (provider: EngineId) =>
      key(provider) === "pi:managed" ? managed.error : errors[key(provider)],
    load,
  };
}
