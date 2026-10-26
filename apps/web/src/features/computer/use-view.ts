import type { ComputerActivity } from "@domos/agent/computer/activity";
import type {
  ViewerAction,
  ViewFrame,
} from "@domos/agent/computer/viewer-types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { client } from "../../client.ts";
import { viewerQueue } from "./viewer-input.ts";

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
  const [busy, setBusy] = useState(false);
  const handoff = useRef(false);
  const [blocked, setBlocked] = useState(false);
  const session = useRef<{ send: (action: ViewerAction) => Promise<boolean> }>(
    undefined,
  );
  useEffect(() => {
    const { botId, service } = connection;
    const controller = new AbortController();
    setFrame(undefined);
    setActivity(null);
    setConnected(false);
    setControlling(false);
    setError(undefined);
    setBusy(false);
    handoff.current = false;
    setBlocked(false);
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
          const dispatch = async (action: ViewerAction) => {
            controller.signal.throwIfAborted();
            const state = await client.computer.input(
              { botId, view: event.id, action },
              { signal: controller.signal },
            );
            if (!controller.signal.aborted && action.type !== "ack")
              setControlling(state.controlling);
          };
          const failed = (cause: unknown) => {
            if (!controller.signal.aborted) {
              setBlocked(true);
              setError(
                cause instanceof Error
                  ? cause.message
                  : "操作未确认。请检查画面。",
              );
            }
          };
          const enqueue = viewerQueue(dispatch, failed);
          session.current = {
            send: async (action) => {
              if (action.type === "ack") {
                try {
                  await dispatch(action);
                  return true;
                } catch (cause) {
                  failed(cause);
                  return false;
                }
              }
              return enqueue(action);
            },
          };
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
        if (!controller.signal.aborted) session.current = undefined;
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
  const send = useCallback(async (action: ViewerAction) => {
    const target = session.current;
    if (!target) return false;
    const control = action.type === "take" || action.type === "back";
    if (control) {
      if (handoff.current) return false;
      handoff.current = true;
      setBusy(true);
    }
    try {
      return await target.send(action);
    } finally {
      if (control && session.current === target) {
        handoff.current = false;
        setBusy(false);
      }
    }
  }, []);
  return {
    frame,
    activity,
    connected,
    controlling,
    error,
    busy,
    blocked,
    send,
    reconnect: async () => {
      const target = session.current;
      if (target && !(await target.send({ type: "back" }))) return;
      setAttempt((value) => value + 1);
    },
  };
}
