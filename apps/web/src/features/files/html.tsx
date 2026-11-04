import { metrics, themes } from "@domos/ui/tokens";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { htmlDocument } from "./html-document.ts";

export function HtmlPreview({
  html,
  title,
  target,
  inline,
}: {
  html: string;
  title: string;
  target?: HTMLElement | null;
  inline: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [surface] = useState(() => document.createElement("div"));
  const [height, setHeight] = useState(240);
  const source = useMemo(() => htmlDocument(html), [html]);
  useLayoutEffect(() => {
    surface.className = "file-html-surface";
    const destination = target ?? host.current;
    if (surface.isConnected && destination?.moveBefore)
      destination.moveBefore(surface, null);
    else destination?.append(surface);
  }, [surface, target]);
  useEffect(() => () => surface.remove(), [surface]);
  useEffect(() => {
    const message = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.type !== "domos:file-height" ||
        !Number.isFinite(event.data.height)
      )
        return;
      setHeight(Math.max(180, Math.min(720, event.data.height)));
    };
    window.addEventListener("message", message);
    return () => window.removeEventListener("message", message);
  }, []);
  const sendTheme = () => {
    const theme =
      document.documentElement.dataset.theme === "dark"
        ? themes.dark
        : themes.light;
    frame.current?.contentWindow?.postMessage(
      {
        type: "domos:file-theme",
        scheme: document.documentElement.dataset.theme,
        values: {
          ...Object.fromEntries(
            Object.entries(theme).map(([key, value]) => [
              `--color-${key}`,
              value,
            ]),
          ),
          "--font-sans": metrics["font-body"],
        },
      },
      "*",
    );
  };
  useEffect(() => {
    const observer = new MutationObserver(sendTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  });
  return (
    <div
      className="file-html"
      ref={host}
      style={{ height: inline && !target ? height : undefined }}
    >
      {createPortal(
        <iframe
          ref={frame}
          title={title}
          srcDoc={source}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          onLoad={sendTheme}
        />,
        surface,
      )}
    </div>
  );
}
