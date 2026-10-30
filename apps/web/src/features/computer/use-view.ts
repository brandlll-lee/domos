import type { ViewFrame } from "@domos/agent/computer/viewer-types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { client } from "../../client.ts";
import { type ViewerInput, viewerQueue } from "./viewer-input.ts";

export function useView(
  botId: number,
  service: "browser" | "desktop",
  takeoverId?: string,
) {
  const [attempt, setAttempt] = useState(0);
  const connection = useMemo(
    () => ({ botId, service, attempt }),
    [botId, service, attempt],
  );
  const [frame, setFrame] = useState<ViewFrame>();
  const [connected, setConnected] = useState(false);
  const [controlling, setControlling] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const handoff = useRef(false);
  const frameRate = useRef(30);
  const requestId = useRef(takeoverId);
  requestId.current = takeoverId;
  const [blocked, setBlocked] = useState(false);
  const session = useRef<{ send: (action: ViewerInput) => Promise<boolean> }>(
    undefined,
  );
  useEffect(() => {
    const { botId, service } = connection;
    const controller = new AbortController();
    setFrame(undefined);
    setConnected(false);
    setControlling(false);
    setError(undefined);
    setBusy(false);
    handoff.current = false;
    frameRate.current = 30;
    setBlocked(false);
    void (async () => {
      const stream = await client.computer.watch(
        { botId, service },
        { signal: controller.signal },
      );
      for await (const event of stream) {
        if (controller.signal.aborted) break;
        if (event.type === "ready") {
          const dispatch = async (action: ViewerInput) => {
            controller.signal.throwIfAborted();
            const takeoverId = requestId.current;
            if (action.type === "complete") {
              if (!takeoverId) throw new Error("接管请求已失效。");
              await client.engines.answer(
                { botId, id: takeoverId, allow: true },
                { signal: controller.signal },
              );
              setControlling(false);
              return;
            }
            if (takeoverId && action.type === "take") {
              await client.engines.takeRequest(
                { botId, id: takeoverId, view: event.id },
                { signal: controller.signal },
              );
              setControlling(true);
              return;
            }
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
                  const started = performance.now();
                  await dispatch({ ...action, maxFps: frameRate.current });
                  frameRate.current =
                    performance.now() - started > 100 ? 10 : 30;
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
  const send = useCallback(async (action: ViewerInput) => {
    const target = session.current;
    if (!target) return false;
    const control =
      action.type === "take" ||
      action.type === "back" ||
      action.type === "complete";
    if (handoff.current && !control && action.type !== "ack") return false;
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
  useEffect(() => {
    if (connected && takeoverId) void send({ type: "take" });
  }, [connected, takeoverId, send]);
  useEffect(() => {
    if (!takeoverId) return;
    const complete = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          botId: number;
          id: string;
          handled: boolean;
          finish: (ok: boolean) => void;
        }>
      ).detail;
      if (detail.botId !== botId || detail.id !== takeoverId) return;
      detail.handled = true;
      void send({ type: "complete" }).then(detail.finish);
    };
    window.addEventListener("domos:takeover-complete", complete);
    return () =>
      window.removeEventListener("domos:takeover-complete", complete);
  }, [botId, takeoverId, send]);
  return {
    frame,
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
