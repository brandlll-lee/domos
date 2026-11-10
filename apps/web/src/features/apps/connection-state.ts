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
