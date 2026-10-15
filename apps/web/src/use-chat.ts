import type { ChatView } from "@domos/agent/view";
import { useEffect, useRef, useState } from "react";
import { client } from "./client.ts";

export function useChat() {
  const [view, setView] = useState<ChatView | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const pending = useRef<{ text: string; requestId: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const events = await client.subscribe(undefined, {
          signal: controller.signal,
          context: {
            retry: Number.POSITIVE_INFINITY,
            onRetry: () => {
              setConnected(false);
            },
          },
        });
        for await (const next of events) {
          if (controller.signal.aborted) return;
          setView(next);
          setConnected(true);
        }
      } catch {
        if (!controller.signal.aborted) setError("连接失败。请刷新页面重试。");
      } finally {
        if (!controller.signal.aborted) setConnected(false);
      }
    })();
    return () => controller.abort();
  }, []);

  async function send(text: string) {
    if (sending) return false;
    setSending(true);
    setError(null);
    const input =
      pending.current?.text === text
        ? pending.current
        : { text, requestId: crypto.randomUUID() };
    pending.current = input;
    try {
      await client.send(input);
      pending.current = null;
      return true;
    } catch {
      setError("发送未确认。可再次发送，系统会核对同一条请求。");
      return false;
    } finally {
      setSending(false);
    }
  }

  async function stop() {
    setStopping(true);
    setError(null);
    try {
      await client.stop();
    } catch {
      setError("停止失败。请重试。");
    } finally {
      setStopping(false);
    }
  }

  return { view, connected, error, sending, stopping, send, stop };
}
