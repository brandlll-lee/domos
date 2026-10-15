import type { ChatView } from "@domos/agent/view";
import { useEffect, useState } from "react";
import { client } from "../../client.ts";
import { rejectionMessage } from "./request-error.ts";

export type SendInput = { text: string; requestId: string };

export function useChat() {
  const [view, setView] = useState<ChatView | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const events = await client.subscribe(undefined, {
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

  async function send(input: SendInput) {
    setSending(true);
    setError(null);
    try {
      await client.send(input);
      return "accepted" as const;
    } catch (cause) {
      const message = rejectionMessage(cause);
      setError(message ?? "发送未确认。重试会核对原请求。");
      return message ? ("rejected" as const) : ("unconfirmed" as const);
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
