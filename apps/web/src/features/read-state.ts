import { useEffect, useSyncExternalStore } from "react";

export function createReadState<T>(read: (signal: AbortSignal) => Promise<T>) {
  let state: { data?: T; error?: unknown; loading: boolean; revision: number } =
    {
      loading: false,
      revision: 0,
    };
  let pending: Promise<T> | undefined;
  let controller: AbortController | undefined;
  let fresh = false;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<typeof state>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const store = {
    snapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    receive(data: T) {
      controller?.abort();
      pending = undefined;
      fresh = true;
      update({
        data,
        error: undefined,
        loading: false,
        revision: state.revision + 1,
      });
    },
    fail(error: unknown) {
      update({ error, loading: false });
    },
    load(refresh = false): Promise<T> {
      if (pending) return pending;
      if (fresh && !refresh) {
        return state.error
          ? Promise.reject(state.error)
          : Promise.resolve(state.data as T);
      }
      controller?.abort();
      controller = new AbortController();
      const revision = state.revision;
      update({ loading: true, error: undefined });
      pending = read(controller.signal)
        .then((data) => {
          if (revision === state.revision) update({ data, error: undefined });
          return data;
        })
        .catch((error: unknown) => {
          if (revision === state.revision) update({ error });
          throw error;
        })
        .finally(() => {
          if (revision === state.revision) {
            pending = undefined;
            fresh = true;
            update({ loading: false });
          }
        });
      return pending;
    },
    invalidate() {
      controller?.abort();
      pending = undefined;
      fresh = false;
      update({
        revision: state.revision + 1,
        loading: false,
        error: undefined,
      });
    },
    dispose() {
      controller?.abort();
      listeners.clear();
      state = { loading: false, revision: state.revision + 1 };
    },
    clear() {
      controller?.abort();
      pending = undefined;
      fresh = false;
      state = { loading: false, revision: state.revision + 1 };
      update({});
    },
  };
  return store;
}

export function useReadState<T>(
  store: ReturnType<typeof createReadState<T>>,
  active = true,
) {
  const state = useSyncExternalStore(store.subscribe, store.snapshot);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A revision change invalidates the retained read.
  useEffect(() => {
    if (active) void store.load().catch(() => {});
  }, [store, active, state.revision]);
  return state;
}
