import type { EngineConfig } from "@domos/agent/harness/types";
import { useSyncExternalStore } from "react";
import { client } from "../../client.ts";
import { invalidateNativeConnections } from "../apps/connection-state.ts";
import { invalidateBotWork } from "../bots/details/use-bot-work.ts";
import { createReadState } from "../read-state.ts";
import { invalidateQuota } from "../usage/quota-state.ts";

type Profile = Awaited<ReturnType<typeof client.engines.get>>;
type Connection = Awaited<ReturnType<typeof client.engines.inspect>>;
type ServiceStatus = Awaited<ReturnType<typeof client.engines.status>>;
const stores = new Map<number, ReturnType<typeof createSettings>>();
window.addEventListener("domos:computer", () => stores.clear());
window.addEventListener("domos:pair", () => stores.clear());
const keyOf = (config: EngineConfig) =>
  JSON.stringify([config.provider, config.command, config.args]);

function createSettings(botId: number) {
  let state: {
    profile?: Profile;
    selected?: EngineConfig;
    connections: Record<string, Connection>;
    inspectionErrors: Record<string, string>;
    inspecting: Record<string, boolean>;
    choices: Partial<Record<EngineConfig["provider"], EngineConfig>>;
    saving: boolean;
    error: string;
  } = {
    connections: {},
    inspectionErrors: {},
    inspecting: {},
    choices: {},
    saving: false,
    error: "",
  };
  let generation = 0;
  let busy: boolean | undefined;
  let confirmed: Profile | undefined;
  let pending = Promise.resolve();
  let reading: Promise<Profile> | undefined;
  const inspections = new Map<string, Promise<Connection>>();
  const statuses = new Map<
    string,
    ReturnType<typeof createReadState<ServiceStatus>>
  >();
  const listeners = new Set<() => void>();
  const update = (patch: Partial<typeof state>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const statusKey = (key: string, admin: boolean) =>
    JSON.stringify([key, admin]);
  const remember = (config: EngineConfig, connection: Connection) => {
    const key = keyOf(config);
    for (const admin of [true, false])
      statuses.get(statusKey(key, admin))?.receive(connection);
    update({
      connections: { ...state.connections, [key]: connection },
      inspectionErrors: { ...state.inspectionErrors, [key]: "" },
    });
  };
  const receive = (profile: Profile) => {
    if (
      confirmed &&
      profile.computerId === confirmed.computerId &&
      profile.revision < confirmed.revision
    )
      return;
    const changed = confirmed && confirmed.computerId !== profile.computerId;
    if (
      confirmed &&
      (changed || keyOf(confirmed.config) !== keyOf(profile.config))
    ) {
      invalidateNativeConnections(botId);
      invalidateBotWork(botId);
      invalidateQuota(botId);
    }
    if (busy !== undefined) profile = { ...profile, busy };
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
    inspectionError: (config: EngineConfig) =>
      state.inspectionErrors[keyOf(config)],
    inspecting: (config: EngineConfig) =>
      Boolean(state.inspecting[keyOf(config)]),
    serviceStatus(config: EngineConfig, admin: boolean) {
      const key = statusKey(keyOf(config), admin);
      let status = statuses.get(key);
      if (!status) {
        status = createReadState<ServiceStatus>((signal, refresh) =>
          admin
            ? client.engines.status({ botId, config, refresh }, { signal })
            : client.engines.available({ botId }, { signal }),
        );
        statuses.set(key, status);
      }
      return status;
    },
    remember,
    load(refresh = false) {
      if (state.profile && !refresh) return Promise.resolve(state.profile);
      const current = generation;
      reading ??= client.engines
        .get({ botId })
        .then((profile) => {
          if (current === generation) receive(profile);
          return profile;
        })
        .finally(() => {
          if (current === generation) reading = undefined;
        });
      return reading;
    },
    inspect(config: EngineConfig, admin: boolean, refresh = false) {
      const key = keyOf(config);
      const pending = inspections.get(key);
      if (pending) return pending;
      if (!refresh && state.inspectionErrors[key])
        return Promise.reject(new Error(state.inspectionErrors[key]));
      if (!refresh && state.connections[key])
        return Promise.resolve(state.connections[key]);
      if (refresh) {
        invalidateNativeConnections(botId);
        invalidateBotWork(botId);
      }
      const current = generation;
      update({
        inspecting: { ...state.inspecting, [key]: true },
        inspectionErrors: { ...state.inspectionErrors, [key]: "" },
      });
      const request = (
        admin
          ? client.engines.inspect({ botId, config, refresh })
          : client.engines.available({ botId })
      )
        .then((connection) => {
          if (current === generation) remember(config, connection);
          return connection;
        })
        .catch((cause: unknown) => {
          if (current === generation)
            update({
              inspectionErrors: {
                ...state.inspectionErrors,
                [key]:
                  cause instanceof Error ? cause.message : "连接读取失败。",
              },
            });
          throw cause;
        })
        .finally(() => {
          if (inspections.get(key) === request) inspections.delete(key);
          if (current === generation)
            update({ inspecting: { ...state.inspecting, [key]: false } });
        });
      inspections.set(key, request);
      return request;
    },
    invalidate() {
      generation++;
      reading = undefined;
      confirmed = undefined;
      inspections.clear();
      for (const status of statuses.values()) status.clear();
      update({
        profile: undefined,
        selected: undefined,
        connections: {},
        inspectionErrors: {},
        inspecting: {},
        choices: {},
      });
    },
    setBusy(value: boolean) {
      busy = value;
      if (state.profile && state.profile.busy !== value)
        update({ profile: { ...state.profile, busy: value } });
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

export function clearModelSettings(ids?: Set<number>) {
  for (const id of stores.keys()) if (!ids?.has(id)) stores.delete(id);
}
export function invalidateModelSettings(botId: number) {
  const store = stores.get(botId);
  store?.invalidate();
  if (store) void store.load().catch(() => {});
}
export function receiveModelActivity(botId: number, busy: boolean) {
  stores.get(botId)?.setBusy(busy);
}
export const flushModelSettings = (botId: number) => settingsFor(botId).flush();

export const readModelSettings = (botId: number) => settingsFor(botId).load();
