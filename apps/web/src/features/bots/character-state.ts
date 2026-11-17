import type { Bot } from "@domos/agent/bots";
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
export function receiveCharacter(bot: Bot) {
  if (!bot.avatarAssetId) return;
  for (const key of [0, bot.id]) {
    const store = stores.get(key);
    const state = store?.snapshot();
    if (
      state?.data &&
      !state.loading &&
      !state.error &&
      !state.data.some((item) => item.id === bot.avatarAssetId)
    )
      store?.invalidate();
  }
}
function clear() {
  for (const store of stores.values()) store.dispose();
  stores.clear();
}
window.addEventListener("domos:computer", clear);
window.addEventListener("domos:pair", clear);
