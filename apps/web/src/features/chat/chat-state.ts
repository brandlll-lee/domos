import type { TranscriptItem } from "@domos/agent/transcript";
import type { ChatView } from "@domos/agent/view";
import type { MessageTarget } from "./message-target.ts";

type RetainedChat = {
  view: ChatView | null;
  outgoing: TranscriptItem[];
  sentRequest?: string;
  pendingRequest?: string;
  sending: boolean;
  error: string | null;
  history?: ChatView;
  target?: MessageTarget;
};
const BUDGET = 32 * 1024 * 1024;
const TTL = 10 * 60_000;
let timer: ReturnType<typeof setInterval> | undefined;
let evictions = 0;

function createChatState() {
  let state: RetainedChat = {
    view: null,
    outgoing: [],
    sending: false,
    error: null,
  };
  const controller = new AbortController();
  let touched = Date.now();
  let bytes = 0;
  const listeners = new Set<() => void>();
  const store = {
    controller,
    size: () => bytes,
    touched: () => touched,
    protected: () =>
      listeners.size > 0 ||
      state.sending ||
      Boolean(
        state.pendingRequest &&
          !state.view?.messages.some(
            (message) => message.requestId === state.pendingRequest,
          ),
      ),
    snapshot: () => state,
    observed: () => listeners.size > 0,
    subscribe(listener: () => void) {
      listeners.add(listener);
      touched = Date.now();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          store.trim();
          sweepChatCache();
        }
      };
    },
    trim() {
      const view = state.view;
      const messages = view?.messages.slice(-200);
      store.update({
        history: undefined,
        target: undefined,
        ...(view && messages
          ? {
              view: {
                ...view,
                messages,
                ...(messages.length < view.messages.length
                  ? { before: messages[0]?.cursor }
                  : {}),
                runs: view.runs?.filter((run) =>
                  messages.some((message) => message.turnId === run.turnId),
                ),
              },
            }
          : {}),
      });
    },
    update(patch: Partial<RetainedChat>) {
      if (controller.signal.aborted) return;
      state = { ...state, ...patch };
      touched = Date.now();
      bytes = JSON.stringify(state).length * 2;
      sweepChatCache();
      for (const listener of listeners) listener();
    },
  };
  return store;
}
export const retained = new Map<string, ReturnType<typeof createChatState>>();
export function chatState(botId: number, teamId?: string) {
  const key = teamId ? `team:${teamId}` : String(botId);
  let state = retained.get(key);
  if (!state) {
    state = createChatState();
    retained.set(key, state);
  }
  if (!timer) timer = setInterval(sweepChatCache, 60_000);
  return state;
}
export function clearChatState(ids?: Set<number>) {
  for (const id of retained.keys())
    if (!ids || (!id.startsWith("team:") && !ids.has(Number(id)))) evict(id);
}

function evict(key: string) {
  retained.get(key)?.controller.abort();
  retained.delete(key);
  evictions++;
  if (!retained.size && timer) {
    clearInterval(timer);
    timer = undefined;
  }
}
export function chatCacheUsage() {
  const stores = [...retained.values()];
  return {
    entries: stores.length,
    estimatedBytes: stores.reduce((sum, store) => sum + store.size(), 0),
    protectedBytes: stores
      .filter((store) => store.protected())
      .reduce((sum, store) => sum + store.size(), 0),
    evictions,
    budgetBytes: BUDGET,
  };
}
export function sweepChatCache() {
  let total = chatCacheUsage().estimatedBytes;
  for (const [key, store] of [...retained].sort(
    (a, b) => a[1].touched() - b[1].touched(),
  )) {
    if (store.protected()) continue;
    if (Date.now() - store.touched() < TTL && total <= BUDGET) continue;
    total -= store.size();
    evict(key);
  }
  performance.clearMarks("domos.chat-cache");
  performance.mark("domos.chat-cache", { detail: chatCacheUsage() });
}
