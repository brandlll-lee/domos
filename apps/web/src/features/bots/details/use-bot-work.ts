import { useEffect, useRef, useState } from "react";
import { client } from "../../../client.ts";
import { createReadState, useReadState } from "../../read-state.ts";
import { userError } from "../../user-error.ts";

export type WorkData = Awaited<ReturnType<typeof client.work.get>>;
export type Profile = Awaited<ReturnType<typeof client.work.profile>>;
type IdentityDraft = Pick<Profile, "name" | "instructions" | "avatar"> & {
  avatarAssetId?: string | null;
};
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
  const data = createReadState((signal) =>
    client.work.get({ botId }, { signal }),
  );
  let viewers = 0;
  let controller: AbortController | undefined;
  return {
    data,
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
    profile: createReadState((signal) =>
      client.work.profile({ botId }, { signal }),
    ),
    draft: undefined as IdentityDraft | undefined,
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
  const [draft, update] = useState<IdentityDraft>(
    () =>
      retained.get(profile.id)?.draft ?? {
        name: profile.name,
        instructions: profile.instructions,
        avatar: profile.avatar,
        avatarAssetId: profile.avatarAssetId,
      },
  );
  const change = (patch: Partial<IdentityDraft>) =>
    update((current) => {
      const next = { ...current, ...patch };
      const state = retained.get(profile.id);
      if (state) state.draft = next;
      return next;
    });
  return { ...draft, change };
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
  const loaded = !!data.data;
  useEffect(() => {
    if (active && live && loaded) return store.watch();
  }, [active, live, loaded, store]);
  return {
    data: data.data ?? null,
    profile: profile.data ?? null,
    setProfile: (value: Profile) => store.profile.receive(value),
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
