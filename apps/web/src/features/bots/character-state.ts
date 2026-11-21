import type { Bot } from "@domos/agent/bots";
import {
  avatarImageStatus,
  characterPickerImages,
  retryAvatarImages,
} from "@domos/ui/avatar";
import { client } from "../../client.ts";
import { createReadState, useReadState } from "../read-state.ts";

const stores = new Map<number, ReturnType<typeof make>>();
function make(botId?: number) {
  return createReadState(async (signal) => {
    const data = await client.bots.characters({ botId }, { signal });
    const images = [
      ...characterPickerImages,
      ...data.map((item) => item.media.thumbnail ?? item.media.cover),
    ];
    await retryAvatarImages(images);
    signal.throwIfAborted();
    if (images.some((url) => avatarImageStatus(url) !== "ready"))
      throw new Error("角色图片读取失败，请重试。");
    return data;
  });
}
function charactersFor(botId?: number) {
  const key = botId ?? 0;
  let store = stores.get(key);
  if (!store) {
    store = make(botId);
    stores.set(key, store);
  }
  return store;
}
export function prepareCharacters(botId?: number) {
  const store = charactersFor(botId);
  return store.load(!!store.snapshot().error);
}
export function invalidateCharacters(botId: number) {
  stores.get(botId)?.clear();
}
export function useCharacters(botId?: number, active = true) {
  const store = charactersFor(botId);
  return { store, ...useReadState(store, active) };
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
