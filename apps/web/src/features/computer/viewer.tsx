import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { ComputerEffect } from "./effect.tsx";
import { useView } from "./use-view.ts";

export function ComputerViewer({
  botId,
  service,
}: {
  botId: number;
  service: "browser" | "desktop";
}) {
  const { frame, activity, connected, controlling, error, send, reconnect } =
    useView(botId, service);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [ratio, setRatio] = useState(16 / 9);
  const image = useRef<HTMLImageElement>(null);
  const acknowledged = useRef<number>(undefined);
  const acknowledge = () => {
    if (frame && acknowledged.current !== frame.seq) {
      acknowledged.current = frame.seq;
      send({ type: "ack", seq: frame.seq });
    }
  };
  useEffect(() => {
    if (frame && image.current?.complete && image.current.naturalWidth) {
      if (acknowledged.current !== frame.seq) {
        acknowledged.current = frame.seq;
        send({ type: "ack", seq: frame.seq });
      }
    }
  }, [frame, send]);
  return (
    <section
      className="computer-viewer"
      aria-label="工作电脑观看"
      data-controlling={controlling || undefined}
      style={
        {
          "--screen-ratio": ratio,
        } as CSSProperties
      }
    >
      {service === "browser" && controlling && (
        <form
          className="computer-view-address"
          onSubmit={(event) => {
            event.preventDefault();
            send({ type: "navigate", url });
          }}
        >
          <TextField
            label="网址"
            type="url"
            placeholder="https://example.com"
            value={url}
            disabled={!controlling}
            onValueChange={setUrl}
            required
          />
          <Button variant="secondary" size="small" disabled={!controlling}>
            打开
          </Button>
        </form>
      )}
      <div className="computer-view-screen">
        {frame ? (
          <img
            ref={image}
            src={`data:${frame.mimeType};base64,${frame.data}`}
            alt="工作电脑画面"
            draggable={false}
            tabIndex={controlling ? 0 : -1}
            onLoad={(event) => {
              const image = event.currentTarget;
              setRatio(image.naturalWidth / image.naturalHeight);
              acknowledge();
            }}
            onContextMenu={(event) => {
              if (controlling) event.preventDefault();
            }}
            onPointerDown={(event) => {
              if (!controlling) return;
              event.preventDefault();
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
              const rect = event.currentTarget.getBoundingClientRect();
              send({
                type: "pointer",
                event: "down",
                x: Math.round(
                  ((event.clientX - rect.left) * frame.width) / rect.width,
                ),
                y: Math.round(
                  ((event.clientY - rect.top) * frame.height) / rect.height,
                ),
                button:
                  event.button === 2
                    ? "right"
                    : event.button === 1
                      ? "middle"
                      : "left",
                deltaX: 0,
                deltaY: 0,
              });
            }}
            onPointerUp={(event) => {
              if (!controlling) return;
              const rect = event.currentTarget.getBoundingClientRect();
              send({
                type: "pointer",
                event: "up",
                x: Math.max(
                  0,
                  Math.min(
                    frame.width,
                    Math.round(
                      ((event.clientX - rect.left) * frame.width) / rect.width,
                    ),
                  ),
                ),
                y: Math.max(
                  0,
                  Math.min(
                    frame.height,
                    Math.round(
                      ((event.clientY - rect.top) * frame.height) / rect.height,
                    ),
                  ),
                ),
                button:
                  event.button === 2
                    ? "right"
                    : event.button === 1
                      ? "middle"
                      : "left",
                deltaX: 0,
                deltaY: 0,
              });
            }}
            onWheel={(event) => {
              if (!controlling) return;
              const rect = event.currentTarget.getBoundingClientRect();
              send({
                type: "pointer",
                event: "scroll",
                x: Math.round(
                  ((event.clientX - rect.left) * frame.width) / rect.width,
                ),
                y: Math.round(
                  ((event.clientY - rect.top) * frame.height) / rect.height,
                ),
                button: "left",
                deltaX: event.deltaX,
                deltaY: event.deltaY,
              });
            }}
            onKeyDown={(event) => {
              if (
                !controlling ||
                event.key === "Tab" ||
                event.key === "Escape" ||
                event.nativeEvent.isComposing
              )
                return;
              event.preventDefault();
              if (
                event.key.length === 1 &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.altKey
              )
                send({ type: "text", text: event.key });
              else
                send({
                  type: "key",
                  key: event.key,
                  modifiers:
                    Number(event.altKey) +
                    2 * Number(event.ctrlKey) +
                    4 * Number(event.metaKey) +
                    8 * Number(event.shiftKey),
                });
            }}
          />
        ) : (
          <p className="detail-note">
            {error ? "画面暂不可用。" : "正在读取工作电脑画面…"}
          </p>
        )}
        {frame && (
          <ComputerEffect state={connected && !controlling ? activity : null} />
        )}
      </div>
      <div className="computer-view-toolbar">
        <span role="status">
          {connected
            ? controlling
              ? "你正在接管"
              : service === "browser"
                ? "浏览器画面"
                : "电脑屏幕"
            : error
              ? "连接已断开"
              : "正在连接…"}
        </span>
        <Button
          variant="ghost"
          size="small"
          disabled={!connected}
          onClick={() => send({ type: controlling ? "back" : "take" })}
        >
          {controlling ? "交还控制权" : "接管"}
        </Button>
      </div>
      {controlling && (
        <form
          className="computer-view-address"
          onSubmit={(event) => {
            event.preventDefault();
            if (text) {
              send({ type: "text", text });
              setText("");
            }
          }}
        >
          <TextField
            label="输入到工作电脑"
            value={text}
            onValueChange={setText}
            placeholder="输入文字，支持中文"
            autoComplete="off"
          />
          <Button variant="secondary" size="small">
            输入
          </Button>
        </form>
      )}
      {error && (
        <div role="alert" className="alert">
          {error}
          <Button variant="ghost" size="small" onClick={reconnect}>
            重新连接
          </Button>
        </div>
      )}
    </section>
  );
}
