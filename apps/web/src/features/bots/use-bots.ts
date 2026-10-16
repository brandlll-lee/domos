import type { Bot, BotPresence } from "@domos/agent/bots";
import { useEffect, useState, useSyncExternalStore } from "react";
import { client } from "../../client.ts";

function subscribeLocation(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

export const selectBot = (bot: Bot) => {
  window.location.hash = `bot/${bot.id}`;
};

export function useBots() {
  const [items, setItems] = useState<BotPresence[]>([]);
  const [computers, updateComputers] = useState<
    Awaited<ReturnType<typeof client.computer.list>>
  >({ items: [], defaultId: null, bindings: {} });
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hash = useSyncExternalStore(
    subscribeLocation,
    () => window.location.hash,
  );
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const events = await client.bots.subscribe(undefined, {
          signal: controller.signal,
          context: {
            retry: Number.POSITIVE_INFINITY,
            onRetry: () => {
              if (!controller.signal.aborted) setConnected(false);
            },
          },
        });
        for await (const next of events) {
          if (controller.signal.aborted) return;
          setItems(next.items);
          updateComputers({
            items: next.computers,
            defaultId: next.defaultComputerId,
            bindings: next.bindings,
          });
          setConnected(true);
          setError(null);
        }
      } catch {
        if (!controller.signal.aborted)
          setError("联系人加载失败。请刷新重试。");
      } finally {
        if (!controller.signal.aborted) setConnected(false);
      }
    })();
    return () => controller.abort();
  }, []);
  const match = /^#bot\/(\d+)$/.exec(hash);
  const selected =
    items.find((bot) => bot.id === Number(match?.[1])) ?? items[0];
  return { items, selected, error, connected, computers, updateComputers };
}
