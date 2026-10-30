import type { EngineConfig } from "@domos/agent/harness/types";
import { useSyncExternalStore } from "react";
import { client } from "../../client.ts";

type Profile = Awaited<ReturnType<typeof client.engines.get>>;
type Connection = Awaited<ReturnType<typeof client.engines.inspect>>;
const stores = new Map<number, ReturnType<typeof createSettings>>();
const keyOf = (config: EngineConfig) =>
  JSON.stringify([config.provider, config.command, config.args]);

function createSettings(botId: number) {
  let state: {
    profile?: Profile;
    selected?: EngineConfig;
    connections: Record<string, Connection>;
    choices: Partial<Record<EngineConfig["provider"], EngineConfig>>;
    saving: boolean;
    error: string;
  } = { connections: {}, choices: {}, saving: false, error: "" };
  let confirmed: Profile | undefined;
  let pending = Promise.resolve();
  let reading: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<typeof state>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const receive = (profile: Profile) => {
    if (
      confirmed &&
      profile.computerId === confirmed.computerId &&
      profile.revision < confirmed.revision
    )
      return;
    const changed = confirmed && confirmed.computerId !== profile.computerId;
    confirmed = profile;
    update({
      profile,
      ...(!state.saving
        ? {
            selected: profile.config,
            choices: {
              ...state.choices,
              [profile.config.provider]: profile.config,
            },
          }
        : {}),
      connections: {
        ...(changed ? {} : state.connections),
        ...(profile.connection
          ? { [keyOf(profile.config)]: profile.connection }
          : {}),
      },
    });
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => state,
    connection: (config: EngineConfig) => state.connections[keyOf(config)],
    remember(config: EngineConfig, connection: Connection) {
      update({
        connections: { ...state.connections, [keyOf(config)]: connection },
      });
    },
    load() {
      reading ??= client.engines
        .get({ botId })
        .then(receive)
        .finally(() => {
          reading = undefined;
        });
      return reading;
    },
    inspect(config: EngineConfig, admin: boolean, refresh = false) {
      return (
        admin
          ? client.engines.inspect({ botId, config, refresh })
          : client.engines.available({ botId })
      ).then((connection) => {
        update({
          connections: { ...state.connections, [keyOf(config)]: connection },
        });
        return connection;
      });
    },
    save(config: EngineConfig, admin: boolean) {
      update({
        selected: config,
        choices: { ...state.choices, [config.provider]: config },
        saving: true,
        error: "",
      });
      const next = pending.then(async () => {
        if (!confirmed) throw new Error("模型配置尚未加载。");
        const input = {
          botId,
          revision: confirmed.revision,
          requestId: crypto.randomUUID(),
        };
        const saved = admin
          ? await client.engines.configure({ ...input, config })
          : await client.engines.select({
              ...input,
              model: config.model,
              options: config.options,
            });
        receive(saved);
      });
      const settled = next
        .catch(async (cause) => {
          try {
            receive(await client.engines.get({ botId }));
          } catch {}
          if (pending === settled)
            update({
              selected: confirmed?.config,
              choices: {
                ...state.choices,
                [config.provider]:
                  confirmed?.config.provider === config.provider
                    ? confirmed.config
                    : undefined,
              },
              error: cause.message,
            });
        })
        .finally(() => {
          if (pending === settled) update({ saving: false });
        });
      pending = settled;
      return settled;
    },
    async flush() {
      let current: Promise<void>;
      do {
        current = pending;
        await current;
      } while (current !== pending);
      if (state.error) throw new Error(state.error);
    },
  };
}

function settingsFor(botId: number) {
  let store = stores.get(botId);
  if (!store) {
    store = createSettings(botId);
    stores.set(botId, store);
  }
  return store;
}

export function useModelSettings(botId: number) {
  const store = settingsFor(botId);
  return { store, ...useSyncExternalStore(store.subscribe, store.snapshot) };
}

export const flushModelSettings = (botId: number) => settingsFor(botId).flush();
