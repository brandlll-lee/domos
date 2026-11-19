import { client, computerScope } from "../../client.ts";
import { createReadState } from "../read-state.ts";

type Quota = Awaited<ReturnType<typeof client.engines.quota>>;
const stores = new Map<string, ReturnType<typeof createReadState<Quota>>>();
const clear = () => {
  for (const store of stores.values()) store.dispose();
  stores.clear();
};
window.addEventListener("domos:computer", clear);
window.addEventListener("domos:pair", clear);
export function quotaStore(botId: number) {
  const key = `${computerScope}:${botId}`;
  let store = stores.get(key);
  if (!store) {
    store = createReadState((signal, refresh) =>
      client.engines.quota(
        { botId, refresh },
        { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) },
      ),
    );
    stores.set(key, store);
  }
  return store;
}

export function invalidateQuota(botId: number) {
  stores.get(`${computerScope}:${botId}`)?.invalidate();
}
