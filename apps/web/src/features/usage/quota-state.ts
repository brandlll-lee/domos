import { client, computerScope } from "../../client.ts";
import { createReadState } from "../read-state.ts";

type Quota = Awaited<ReturnType<typeof client.engines.quota>>;
const stores = new Map<string, ReturnType<typeof createReadState<Quota>>>();
export const quotaCatalog = createReadState(() => client.engines.catalog());
const lanes: Promise<unknown>[] = [
  Promise.resolve(),
  Promise.resolve(),
  Promise.resolve(),
];
let next = 0;
const clear = () => {
  for (const store of stores.values()) store.dispose();
  stores.clear();
  quotaCatalog.clear();
};
window.addEventListener("domos:computer", clear);
window.addEventListener("domos:pair", clear);
export function quotaStore(provider: string) {
  const key = `${computerScope}:${provider}`;
  let store = stores.get(key);
  if (!store) {
    store = createReadState((signal, refresh) => {
      const index = next++ % lanes.length;
      const read = () => {
        signal.throwIfAborted();
        return client.engines.quota(
          { provider, refresh },
          { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) },
        );
      };
      const pending = lanes[index]!.then(read, read);
      lanes[index] = pending;
      return pending;
    });
    stores.set(key, store);
  }
  return store;
}

export function invalidateQuota() {
  for (const store of stores.values()) store.invalidate();
}
