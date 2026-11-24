import { useEffect, useMemo, useReducer } from "react";
import { client } from "../../client.ts";
import { createReadState } from "../read-state.ts";

export const managedConnections = createReadState((signal) =>
  client.mcp.list(undefined, { signal }),
);
export const appCatalog = createReadState((signal) =>
  client.mcp.catalog(undefined, { signal }),
);
const native = new Map<number, ReturnType<typeof createNative>>();
function createNative(botId: number) {
  return createReadState((signal) => client.mcp.native({ botId }, { signal }));
}
export function nativeConnections(botId: number) {
  let store = native.get(botId);
  if (!store) {
    store = createNative(botId);
    native.set(botId, store);
  }
  return store;
}
export function invalidateNativeConnections(botId: number) {
  native.get(botId)?.clear();
}
export function clearConnections(ids?: Set<number>) {
  for (const [id, store] of native)
    if (!ids?.has(id)) {
      store.dispose();
      native.delete(id);
    }
}
function clear() {
  managedConnections.clear();
  appCatalog.clear();
  clearConnections();
}
window.addEventListener("domos:computer", clear);
window.addEventListener("domos:pair", clear);

export function useNativeCatalogs(
  bots: { id: number; name: string }[],
  active: boolean,
) {
  const ids = bots.map((bot) => bot.id).join(",");
  const stores = useMemo(
    () =>
      ids ? ids.split(",").map((id) => nativeConnections(Number(id))) : [],
    [ids],
  );
  const [, update] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    const subscriptions = stores.map((store) => store.subscribe(update));
    let disposed = false;
    if (active)
      void (async () => {
        for (const store of stores) {
          if (disposed) break;
          await store.load().catch(() => {});
        }
      })();
    return () => {
      disposed = true;
      for (const unsubscribe of subscriptions) unsubscribe();
    };
  }, [stores, active]);
  const sources = bots.map((bot, index) => ({
    bot,
    ...stores[index]?.snapshot(),
  }));
  return {
    sources,
    loading: sources.some(
      (source) => source.loading || (!source.data && !source.error),
    ),
    async refresh() {
      for (const store of stores) await store.load(true).catch(() => {});
    },
  };
}
