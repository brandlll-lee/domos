import type {
  ViewerAction,
  ViewFrame,
} from "@domos/agent/computer/viewer-types";
import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "../../client.ts";

export function useView(botId: number, service: "browser" | "desktop") {
  const [controller, setController] = useState(() => new AbortController());
  const [frame, setFrame] = useState<ViewFrame>();
  const [connected, setConnected] = useState(false);
  const [controlling, setControlling] = useState(false);
  const [error, setError] = useState<string>();
  const session = useRef<{ id: string; signal: AbortSignal }>(undefined);
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    setFrame(undefined);
    setConnected(false);
    setControlling(false);
    setError(undefined);
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
  }, [botId, service, controller]);
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
    connected,
    controlling,
    error,
    send,
    reconnect: () => setController(new AbortController()),
  };
}
