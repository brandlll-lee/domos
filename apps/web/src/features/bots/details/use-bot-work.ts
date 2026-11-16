import type { BotPresence } from "@domos/agent/bots";
import { ORPCError } from "@orpc/client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { client } from "../../../client.ts";
import { createReadState, useReadState } from "../../read-state.ts";
import { userError } from "../../user-error.ts";
import {
  createIdentityState,
  type IdentityField,
  type Profile,
} from "./identity-state.ts";

export type WorkData = Awaited<ReturnType<typeof client.work.get>>;
export type { Profile } from "./identity-state.ts";
export type WorkAction = ReturnType<typeof useWorkAction>;

export function useWorkAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<{ key: string; id: string } | null>(null);
  const active = useRef(false);
  async function run<T>(
    key: unknown,
    action: (requestId: string) => Promise<T>,
    onSuccess?: (value: T) => void,
  ) {
    if (active.current) return;
    const payload = JSON.stringify(key);
    if (request.current?.key !== payload)
      request.current = { key: payload, id: crypto.randomUUID() };
    active.current = true;
    setBusy(true);
    setError(null);
    try {
      const value = await action(request.current.id);
      request.current = null;
      onSuccess?.(value);
    } catch (cause) {
      setError(userError(cause, "请求未确认。请重试，系统会核对原请求。"));
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return { busy, error, run, clear: () => setError(null) };
}

function createWork(botId: number) {
  const identity = createIdentityState();
  const profile = createReadState((signal) =>
    client.work.profile({ botId }, { signal }),
  );
  let received: Profile | undefined;
  profile.subscribe(() => {
    const value = profile.snapshot().data;
    if (value && value !== received) {
      received = value;
      identity.receive(value);
    }
  });
  const data = createReadState((signal) =>
    client.work.get({ botId }, { signal }),
  );
  let viewers = 0;
  let controller: AbortController | undefined;
  let pendingSave:
    | {
        write: () => Promise<Profile>;
        edits: ReturnType<typeof identity.capture>;
      }
    | undefined;
  return {
    data,
    profile,
    identity,
    directoryKey: undefined as string | undefined,
    retrySave() {
      const pending = pendingSave;
      return pending ? () => this.save([], pending.write) : undefined;
    },
    async save(selected: IdentityField[], write: () => Promise<Profile>) {
      pendingSave ??= { write, edits: identity.capture(selected) };
      const pending = pendingSave;
      try {
        const value = await pending.write();
        identity.saved(value, pending.edits);
        profile.receive(identity.snapshot().profile ?? value);
        pendingSave = undefined;
        return value;
      } catch (error) {
        if (
          error instanceof ORPCError &&
          !["TIMEOUT", "SERVICE_UNAVAILABLE", "INTERNAL_SERVER_ERROR"].includes(
            error.code,
          )
        ) {
          pendingSave = undefined;
          if (error.code === "CONFLICT")
            await profile.load(true).catch(() => {});
        }
        throw error;
      }
    },
    watch() {
      viewers++;
      if (!controller) {
        controller = new AbortController();
        const { signal } = controller;
        void (async () => {
          const events = await client.work.subscribe(
            { botId },
            {
              signal,
              context: {
                retry: Number.POSITIVE_INFINITY,
                onRetry: () => {
                  if (!signal.aborted)
                    data.fail(new Error("详情连接中断，正在重连。"));
                },
              },
            },
          );
          for await (const value of events) {
            if (signal.aborted) return;
            data.receive(value);
          }
        })().catch((error) => {
          if (!signal.aborted) data.fail(error);
        });
      }
      return () => {
        if (--viewers === 0) {
          controller?.abort();
          controller = undefined;
        }
      };
    },
    refresh() {
      if (!viewers) data.invalidate();
    },
    dispose() {
      controller?.abort();
      data.dispose();
    },
  };
}
const retained = new Map<number, ReturnType<typeof createWork>>();
function workFor(botId: number) {
  let store = retained.get(botId);
  if (!store) {
    store = createWork(botId);
    retained.set(botId, store);
  }
  return store;
}
export function refreshBotWork() {
  for (const store of retained.values()) store.refresh();
}
export function invalidateBotWork(botId: number) {
  const store = retained.get(botId);
  store?.data.clear();
}
export function useIdentityDraft(profile: Profile) {
  const identity = workFor(profile.id).identity;
  const state = useSyncExternalStore(identity.subscribe, identity.snapshot);
  if (!state.values) throw new Error("资料尚未加载。");
  return {
    ...state,
    values: state.values,
    change: identity.change,
    changeAppearance: (patch: Partial<typeof state.values.appearance>) =>
      identity.change("appearance", {
        ...(identity.snapshot().values?.appearance ?? state.values.appearance),
        ...patch,
      }),
    resolve: identity.resolve,
    reset: identity.reset,
  };
}
export function receiveBotProfile(bot: BotPresence) {
  const store = retained.get(bot.id);
  if (!store) return;
  const current = store.identity.snapshot().profile;
  if (current && bot.revision < current.revision) return;
  const key = (value: Profile | BotPresence) =>
    JSON.stringify([
      value.revision,
      value.name,
      value.avatar,
      value.avatarAssetId,
      value.avatarMedia,
      value.avatarMigrationError,
    ]);
  const next = key(bot);
  if (store.directoryKey === next) return;
  store.directoryKey = next;
  if (
    (current && key(current) !== next) ||
    (!current && store.profile.snapshot().loading)
  )
    store.profile.invalidate();
}
export function saveBotIdentity(
  botId: number,
  selected: IdentityField[],
  write: () => Promise<Profile>,
) {
  return workFor(botId).save(selected, write);
}
export function clearBotWork(ids?: Set<number>) {
  for (const [id, store] of retained)
    if (!ids?.has(id)) {
      store.dispose();
      store.profile.dispose();
      retained.delete(id);
    }
}
window.addEventListener("domos:pair", () => clearBotWork());
window.addEventListener("domos:computer", () => clearBotWork());
export function useBotWork(
  botId: number,
  active: boolean,
  live: boolean,
  profileActive: boolean,
) {
  const store = workFor(botId);
  const data = useReadState(store.data, active);
  const profile = useReadState(store.profile, profileActive);
  const identity = useSyncExternalStore(
    store.identity.subscribe,
    store.identity.snapshot,
  );
  const loaded = !!data.data;
  useEffect(() => {
    if (active && live && loaded) return store.watch();
  }, [active, live, loaded, store]);
  return {
    data: data.data ?? null,
    profile: identity.profile ?? null,
    retrySave: store.retrySave(),
    error: data.error ? userError(data.error, "详情连接中断。请重试。") : null,
    profileError: profile.error
      ? userError(profile.error, "资料加载失败。请重试。")
      : null,
    retry: () => {
      void (profileActive ? store.profile : store.data)
        .load(true)
        .catch(() => {});
    },
  };
}
