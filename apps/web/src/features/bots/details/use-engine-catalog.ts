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
  const [catalogs, setCatalogs] = useState<
    Record<
      string,
      {
        models: EngineModel[];
        version?: string | null;
      }
    >
  >({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const pending = useRef(new Map<string, Promise<void>>());
  const warmed = useRef(new Set<string>());
  const generation = useRef(0);
  const scope = useRef({ botId, computerId });
  const invalidate = useCallback(() => {
    generation.current++;
    pending.current.clear();
    warmed.current.clear();
    setCatalogs({});
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
  const source = (provider: EngineId) =>
    provider === config?.provider
      ? (config.accountSource ?? "managed")
      : "managed";
  const key = (provider: EngineId, accountSource = source(provider)) =>
    `${provider}:${accountSource}`;
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
  const models = (provider: EngineId, accountSource = source(provider)) =>
    key(provider, accountSource) === "pi:managed"
      ? managedModels
      : catalogs[key(provider, accountSource)]?.models;
  const load = (
    provider: EngineId,
    accountSource = source(provider),
    refresh = false,
  ) => {
    const id = key(provider, accountSource);
    if (id === "pi:managed" || (!refresh && catalogs[id]))
      return Promise.resolve();
    const existing = pending.current.get(id);
    if (existing) return existing;
    const version = generation.current;
    const request = (async () => {
      if (!refresh && !catalogs[id]) {
        const saved = (
          await client.engines.models({ botId, provider, accountSource })
        ).find((item) => item.id === provider);
        if (
          saved &&
          (saved.models.length || saved.version) &&
          version === generation.current
        )
          setCatalogs((current) => ({ ...current, [id]: saved }));
      }
      return client.engines.inspect({
        botId,
        provider,
        accountSource,
      });
    })()
      .then(
        (result) => {
          if (version === generation.current) {
            setCatalogs((current) => ({ ...current, [id]: result }));
            setErrors((current) => ({ ...current, [id]: "" }));
          }
        },
        (cause) => {
          if (version === generation.current) {
            setCatalogs((current) => ({
              ...current,
              [id]: current[id] ?? { models: [] },
            }));
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
      setCatalogs((current) => ({
        ...current,
        ...Object.fromEntries(
          catalogs
            .filter((item) => item.models.length || item.version)
            .map((item) => [key(item.id, item.accountSource), item]),
        ),
      }));
      for (const item of catalogs) {
        const id = key(item.id);
        if (warmed.current.has(id)) continue;
        void load(item.id, item.accountSource, true).then(() => {
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
  const scopeKey = active && config ? `${botId}:${computerId ?? ""}` : null;
  useEffect(() => {
    if (!scopeKey) return;
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
  }, [scopeKey]);
  return {
    models,
    visibility,
    version: (provider: EngineId, accountSource = source(provider)) =>
      catalogs[key(provider, accountSource)]?.version,
    error: (provider: EngineId, accountSource = source(provider)) =>
      key(provider, accountSource) === "pi:managed"
        ? managed.error
        : errors[key(provider, accountSource)],
    load,
  };
}
