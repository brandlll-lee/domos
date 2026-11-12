import { client } from "../../client.ts";
import { createReadState, useReadState } from "../read-state.ts";

const contexts = new Map<number, ReturnType<typeof createContext>>();
const createContext = (botId: number) =>
  createReadState((signal) => client.computer.get({ botId }, { signal }));

window.addEventListener("domos:computer", () => contexts.clear());
window.addEventListener("domos:pair", () => contexts.clear());

export function invalidateConnectionContext(botId: number) {
  contexts.get(botId)?.invalidate();
}

export function clearConnectionContexts(ids: Set<number>) {
  for (const id of contexts.keys()) if (!ids.has(id)) contexts.delete(id);
}

export function useConnectionContext(botId: number) {
  let store = contexts.get(botId);
  if (!store) {
    store = createContext(botId);
    contexts.set(botId, store);
  }
  return { store, ...useReadState(store) };
}
