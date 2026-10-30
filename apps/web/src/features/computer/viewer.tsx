import { Button } from "@domos/ui/controls";
import { ArrowsInIcon } from "@phosphor-icons/react/dist/csr/ArrowsIn";
import { ArrowsOutIcon } from "@phosphor-icons/react/dist/csr/ArrowsOut";
import { CornersInIcon } from "@phosphor-icons/react/dist/csr/CornersIn";
import { CornersOutIcon } from "@phosphor-icons/react/dist/csr/CornersOut";
import { CursorIcon } from "@phosphor-icons/react/dist/csr/Cursor";
import { GearSixIcon } from "@phosphor-icons/react/dist/csr/GearSix";
import { useEffect, useRef, useState } from "react";
import { useView } from "./use-view.ts";
import { ComputerViewport } from "./viewport.tsx";

export function ComputerViewer({
  botId,
  service,
  expanded,
  onExpand,
  onSettings,
  takeoverId,
}: {
  botId: number;
  service: "browser" | "desktop";
  expanded: boolean;
  onExpand: () => void;
  onSettings: () => void;
  takeoverId?: string;
}) {
  const {
    frame,
    connected,
    controlling,
    error,
    busy,
    blocked,
    send,
    reconnect,
  } = useView(botId, service, takeoverId);
  const viewer = useRef<HTMLElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const acknowledged = useRef("");
  const [fullscreen, setFullscreen] = useState(false);
  const [failure, setFailure] = useState<string>();
  const driving = connected && controlling && !busy && !blocked;
  useEffect(() => {
    const changed = () =>
      setFullscreen(document.fullscreenElement === viewer.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  useEffect(() => {
    const exit = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !fullscreen) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (document.fullscreenElement === viewer.current)
        void document.exitFullscreen();
    };
    window.addEventListener("keydown", exit, true);
    return () => window.removeEventListener("keydown", exit, true);
  }, [fullscreen]);
  const acknowledge = () => {
    if (!frame) {
      acknowledged.current = "";
      return;
    }
    const node = image.current;
    if (
      !node?.complete ||
      node.currentSrc !== `data:${frame.mimeType};base64,${frame.data}`
    )
      return;
    const key = `${service}:${frame.seq}`;
    if (acknowledged.current === key) return;
    acknowledged.current = key;
    void send({ type: "ack", seq: frame.seq });
  };
  useEffect(acknowledge, [frame, send, service]);
  const control = () =>
    void send({
      type: controlling ? (takeoverId ? "complete" : "back") : "take",
    });
  const toggleFullscreen = async () => {
    setFailure(undefined);
    try {
      if (document.fullscreenElement === viewer.current)
        await document.exitFullscreen();
      else await viewer.current?.requestFullscreen({ navigationUI: "hide" });
    } catch {
      setFailure("无法进入全屏。请重试。");
    }
  };
  return (
    <section ref={viewer} className="computer-viewer" aria-label="工作电脑观看">
      <div className="computer-view-screen">
        {frame ? (
          <ComputerViewport
            frame={frame}
            driving={driving}
            send={send}
            onLoad={(node) => {
              image.current = node;
              acknowledge();
            }}
          />
        ) : (
          <p className="detail-note">{error ? "画面暂不可用" : "正在连接…"}</p>
        )}
        {frame && connected && !controlling && !blocked && (
          <button
            className="computer-takeover"
            type="button"
            disabled={busy}
            onClick={control}
            aria-label="接管"
          >
            <span className="computer-takeover-icon">
              <CursorIcon weight="fill" />
            </span>
            <span className="computer-takeover-label">
              {busy ? "正在接管…" : "点击接管"}
            </span>
          </button>
        )}
      </div>
      {(error || failure) && (
        <div role="alert" className="computer-view-error">
          {error ?? failure}
          {error && (
            <Button variant="ghost" size="small" onClick={reconnect}>
              重新连接
            </Button>
          )}
        </div>
      )}
      <div className="computer-view-toolbar">
        <span
          role="status"
          className="computer-view-status"
          data-connected={connected || undefined}
        >
          <span className="computer-live-dot" />
          {busy
            ? "正在交接…"
            : blocked
              ? "操作已暂停"
              : connected
                ? controlling
                  ? "你正在操作"
                  : "实时"
                : error
                  ? "已断开"
                  : "连接中"}
        </span>
        <div className="detail-inline">
          {controlling && (
            <Button
              variant="ghost"
              size="small"
              pending={busy}
              disabled={!connected}
              onClick={control}
            >
              {takeoverId ? "完成并继续" : "交还"}
            </Button>
          )}
          {!fullscreen && (
            <Button
              variant="ghost"
              size="icon-small"
              title={expanded ? "收起工作区" : "展开工作区"}
              aria-label={expanded ? "收起工作区" : "展开工作区"}
              onClick={onExpand}
            >
              {expanded ? <ArrowsInIcon /> : <ArrowsOutIcon />}
            </Button>
          )}
          {!fullscreen && (
            <Button
              variant="ghost"
              size="icon-small"
              title="电脑设置"
              aria-label="电脑设置"
              onClick={onSettings}
            >
              <GearSixIcon />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-small"
            title={fullscreen ? "退出全屏" : "全屏"}
            aria-label={fullscreen ? "退出全屏" : "全屏"}
            onClick={toggleFullscreen}
          >
            {fullscreen ? <CornersInIcon /> : <CornersOutIcon />}
          </Button>
        </div>
      </div>
    </section>
  );
}
