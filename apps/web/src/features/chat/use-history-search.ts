import type { ChatSearchResult } from "@domos/agent/chat-directory";
import { useEffect, useMemo, useRef, useState } from "react";
import { client } from "../../client.ts";

export function useHistorySearch() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ChatSearchResult[]>([]);
  const [before, setBefore] = useState<number>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, refresh] = useState(0);
  const request = useRef<AbortController | null>(null);
  const text = query.trim();
  const search = useMemo(() => ({ text, revision }), [text, revision]);
  useEffect(() => {
    const text = search.text;
    request.current?.abort();
    setItems([]);
    setBefore(undefined);
    setError("");
    setLoading(Boolean(text));
    if (!text) return;
    const controller = new AbortController();
    request.current = controller;
    const timer = window.setTimeout(() => {
      void client.chats
        .search(
          { query: text },
          {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(30_000),
            ]),
          },
        )
        .then((page) => {
          if (!controller.signal.aborted) {
            setItems(page.items);
            setBefore(page.before);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setError("聊天记录搜索失败，请重试。");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search]);
  useEffect(() => {
    const clear = () => {
      request.current?.abort();
      setQuery("");
      setItems([]);
      setBefore(undefined);
      setError("");
      setLoading(false);
    };
    window.addEventListener("domos:computer", clear);
    return () => window.removeEventListener("domos:computer", clear);
  }, []);
  return {
    query,
    setQuery,
    items,
    loading,
    error,
    before,
    retry: () => refresh((value) => value + 1),
    async more() {
      if (!before || loading) return;
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setLoading(true);
      setError("");
      try {
        const page = await client.chats.search(
          { query: text, before },
          {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(30_000),
            ]),
          },
        );
        if (!controller.signal.aborted) {
          setItems((items) => [...items, ...page.items]);
          setBefore(page.before);
        }
      } catch {
        if (!controller.signal.aborted) setError("聊天记录搜索失败，请重试。");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
  };
}
