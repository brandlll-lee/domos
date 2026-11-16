import { client } from "../../client.ts";
import { createReadState, useReadState } from "../read-state.ts";

const stores = new Map<number, ReturnType<typeof make>>();
function make(botId?: number) {
  return createReadState((signal) =>
    client.bots.characters({ botId }, { signal }),
  );
}
export function useCharacters(botId?: number) {
  const key = botId ?? 0;
  let store = stores.get(key);
  if (!store) {
    store = make(botId);
    stores.set(key, store);
  }
  return { store, ...useReadState(store, true) };
}
function clear() {
  for (const store of stores.values()) store.dispose();
  stores.clear();
}
window.addEventListener("domos:computer", clear);
window.addEventListener("domos:pair", clear);
