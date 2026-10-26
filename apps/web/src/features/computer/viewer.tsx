import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ComputerEffect } from "./effect.tsx";
import { useView } from "./use-view.ts";
import { ComputerViewport } from "./viewport.tsx";

export function ComputerViewer({
  botId,
  service,
  onTake,
}: {
  botId: number;
  service: "browser" | "desktop";
  onTake: () => void;
}) {
  const {
    frame,
    activity,
    connected,
    controlling,
    error,
    busy,
    blocked,
    send,
    reconnect,
  } = useView(botId, service);
  const [url, setUrl] = useState("");
  const editing = useRef(false);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false);
  const [pending, setPending] = useState(false);
  const [ratio, setRatio] = useState(16 / 9);
  const image = useRef<HTMLImageElement | null>(null);
  const screen = useRef<HTMLDivElement>(null);
  const acknowledged = useRef<string>("");
  const driving = connected && controlling && !busy && !blocked;
  const draft = useCallback((value: string) => {
    setText((text) => text + value);
    setTyping(true);
  }, []);
  useEffect(() => {
    if (!editing.current && frame?.url) setUrl(frame.url);
  }, [frame?.url]);
  useEffect(() => {
    const node = screen.current;
    const viewer = node?.parentElement;
    if (!node || !viewer) return;
    const fit = () => {
      const rect = node.getBoundingClientRect();
      const footer = viewer.getBoundingClientRect().bottom - rect.bottom;
      viewer.style.setProperty(
        "--view-height",
        `${Math.max(96, window.innerHeight - rect.top - footer - 24)}px`,
      );
    };
    const observer = new ResizeObserver(fit);
    observer.observe(viewer);
    window.addEventListener("resize", fit);
    fit();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);
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
  return (
    <section
      className="computer-viewer"
      aria-label="工作电脑观看"
      style={{ "--screen-ratio": ratio } as CSSProperties}
    >
      <div className="computer-view-toolbar">
        <span role="status">
          {busy
            ? "正在交接…"
            : blocked
              ? "操作已暂停"
              : connected
                ? controlling
                  ? "你正在接管"
                  : service === "browser"
                    ? "浏览器画面"
                    : "电脑屏幕"
                : error
                  ? "连接已断开"
                  : "正在连接…"}
        </span>
        <div className="detail-inline">
          {controlling && (
            <Button
              variant="ghost"
              size="small"
              disabled={busy}
              aria-expanded={typing}
              onClick={() => setTyping(!typing)}
            >
              输入文字
            </Button>
          )}
          <Button
            variant="secondary"
            size="small"
            pending={busy}
            disabled={!connected || (!controlling && blocked)}
            onClick={async () => {
              if (await send({ type: controlling ? "back" : "take" })) {
                if (!controlling) onTake();
              }
            }}
          >
            {controlling ? "交还控制权" : "接管"}
          </Button>
        </div>
      </div>
      {service === "browser" && (
        <form
          className="computer-view-address"
          onSubmit={(event) => {
            event.preventDefault();
            editing.current = false;
            void send({ type: "navigate", url });
          }}
        >
          <input
            className="field-control"
            type="url"
            aria-label="网址"
            placeholder="输入网址"
            value={url}
            disabled={!driving}
            required
            onFocus={() => {
              editing.current = true;
            }}
            onBlur={() => {
              editing.current = false;
            }}
            onChange={(event) => setUrl(event.target.value)}
          />
          <Button variant="secondary" size="small" disabled={!driving}>
            打开
          </Button>
        </form>
      )}
      <div ref={screen} className="computer-view-screen">
        {frame ? (
          <ComputerViewport
            frame={frame}
            browser={service === "browser"}
            driving={driving}
            send={send}
            onDraft={draft}
            onLoad={(node) => {
              image.current = node;
              setRatio(node.naturalWidth / node.naturalHeight);
              acknowledge();
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
      {typing && (
        <form
          className="computer-view-address"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!text || !driving || pending) return;
            const value = text;
            setPending(true);
            try {
              if (await send({ type: "text", text: value }))
                setText((current) => (current === value ? "" : current));
            } finally {
              setPending(false);
            }
          }}
        >
          <TextField
            label="输入到网页中已选中的位置"
            value={text}
            onValueChange={setText}
            autoComplete="off"
            disabled={pending}
          />
          <Button
            variant="secondary"
            size="small"
            pending={pending}
            disabled={!driving || !text}
          >
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
