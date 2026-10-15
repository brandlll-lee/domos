import { useEffect, useRef, useState } from "react";
import { client } from "../../../client.ts";

export type WorkData = Awaited<ReturnType<typeof client.work.get>>;
export type Profile = Awaited<ReturnType<typeof client.work.profile>>;
export type WorkAction = ReturnType<typeof useWorkAction>;

export function useWorkAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<{ key: string; id: string } | null>(null);
  const active = useRef(false);
  async function run<T>(
    key: unknown,
    action: (requestId: string) => Promise<T>,
    onSuccess?: (value: T) => void,
  ) {
    if (active.current) return;
    const payload = JSON.stringify(key);
    if (request.current?.key !== payload)
      request.current = { key: payload, id: crypto.randomUUID() };
    active.current = true;
    setBusy(true);
    setError(null);
    try {
      const value = await action(request.current.id);
      request.current = null;
      onSuccess?.(value);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "请求未确认。请重试，系统会核对原请求。",
      );
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return { busy, error, run };
}

export function useBotWork(botId: number) {
  const [data, setData] = useState<WorkData | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void client.work
      .profile({ botId }, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setProfile(value);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("详情加载失败。请关闭后重试。");
      });
    void (async () => {
      try {
        const events = await client.work.subscribe(
          { botId },
          {
            signal: controller.signal,
            context: {
              retry: Number.POSITIVE_INFINITY,
              onRetry: () => {
                if (!controller.signal.aborted) setConnected(false);
              },
            },
          },
        );
        for await (const value of events) {
          if (controller.signal.aborted) return;
          setData(value);
          setConnected(true);
        }
      } catch {
        if (!controller.signal.aborted)
          setError("详情连接中断。请关闭后重试。");
      } finally {
        if (!controller.signal.aborted) setConnected(false);
      }
    })();
    return () => controller.abort();
  }, [botId]);
  return { data, profile, setProfile, error, connected };
}
