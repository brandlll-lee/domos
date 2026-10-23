import type { ComputerActivity } from "@domos/agent/computer/activity";
import type {
  ViewerAction,
  ViewFrame,
} from "@domos/agent/computer/viewer-types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { client } from "../../client.ts";

export function useView(botId: number, service: "browser" | "desktop") {
  const [attempt, setAttempt] = useState(0);
  const connection = useMemo(
    () => ({ botId, service, attempt }),
    [botId, service, attempt],
  );
  const [frame, setFrame] = useState<ViewFrame>();
  const [activity, setActivity] = useState<ComputerActivity>(null);
  const [connected, setConnected] = useState(false);
  const [controlling, setControlling] = useState(false);
  const [error, setError] = useState<string>();
  const session = useRef<{ id: string; signal: AbortSignal }>(undefined);
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    const { botId, service } = connection;
    const controller = new AbortController();
    setFrame(undefined);
    setActivity(null);
    setConnected(false);
    setControlling(false);
    setError(undefined);
    const visual = new AbortController();
    if (service === "desktop")
      void (async () => {
        const stream = await client.computer.activity(
          { botId },
          { signal: AbortSignal.any([controller.signal, visual.signal]) },
        );
        for await (const value of stream) {
          if (controller.signal.aborted || visual.signal.aborted) break;
          setActivity(value);
        }
      })()
        .catch(() => {})
        .finally(() => {
          if (!controller.signal.aborted) setActivity(null);
        });
    void (async () => {
      const stream = await client.computer.watch(
        { botId, service },
        { signal: controller.signal },
      );
      for await (const event of stream) {
        if (controller.signal.aborted) break;
        if (event.type === "ready") {
          session.current = { id: event.id, signal: controller.signal };
          setConnected(true);
        } else setFrame(event.frame);
      }
    })()
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause.message ?? "画面连接已断开。");
      })
      .finally(() => {
        visual.abort();
        if (session.current?.signal === controller.signal)
          session.current = undefined;
        if (!controller.signal.aborted) {
          setConnected(false);
          setControlling(false);
        }
      });
    return () => {
      controller.abort();
      session.current = undefined;
    };
  }, [connection]);
  const send = useCallback(
    (action: ViewerAction) => {
      const target = session.current;
      if (!target || target.signal.aborted) return;
      queue.current = queue.current
        .then(async () => {
          target.signal.throwIfAborted();
          const state = await client.computer.input(
            { botId, view: target.id, action },
            { signal: target.signal },
          );
          if (!target.signal.aborted) setControlling(state.controlling);
        })
        .catch((cause) => {
          if (!target.signal.aborted)
            setError(cause.message ?? "操作未确认。请检查画面。");
        });
    },
    [botId],
  );
  return {
    frame,
    activity,
    connected,
    controlling,
    error,
    send,
    reconnect: () => setAttempt((value) => value + 1),
  };
}
