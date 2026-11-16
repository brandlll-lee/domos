import { useSyncExternalStore } from "react";
import { client } from "../../client.ts";

type State = Awaited<ReturnType<typeof client.images.state>>;
const stores = new Map<number, ReturnType<typeof createStore>>();
function createStore(botId: number) {
  let state: { data?: State; error?: string; pending: boolean } = {
    pending: false,
  };
  let loading: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const update = (next: typeof state) => {
    state = next;
    for (const listener of listeners) listener();
  };
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => state,
    receive: (data: State) => update({ data, pending: false }),
    load(force = false) {
      if (loading) return loading;
      if (state.data && !force) return Promise.resolve();
      update({ ...state, pending: true, error: undefined });
      loading = client.images
        .state({ botId })
        .then(
          (data) => update({ data, pending: false }),
          (error) =>
            update({
              ...state,
              pending: false,
              error:
                error instanceof Error ? error.message : "图像服务读取失败。",
            }),
        )
        .finally(() => {
          loading = undefined;
        });
      return loading;
    },
  };
}
export function clearImageSettings(ids?: Set<number>) {
  for (const id of stores.keys()) if (!ids?.has(id)) stores.delete(id);
}
export function invalidateImageSettings(botId: number) {
  stores.delete(botId);
}
export function useImageSettings(botId: number) {
  let store = stores.get(botId);
  if (!store) {
    store = createStore(botId);
    stores.set(botId, store);
  }
  return { store, ...useSyncExternalStore(store.subscribe, store.snapshot) };
}
