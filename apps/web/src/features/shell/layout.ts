import { layout } from "@domos/ui/tokens";
import { useEffect, useState } from "react";

type Side = "sidebar" | "inspector";
const storageKey = "domos:layout:v1";
const defaults = {
  sidebar: layout.sidebar.initial as number,
  inspector: layout.inspector.initial as number,
};

function readWidths() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    return Object.fromEntries(
      Object.entries(defaults).map(([key, value]) => {
        const limits = layout[key as Side];
        const width = saved?.[key];
        return [
          key,
          typeof width === "number" && Number.isFinite(width)
            ? Math.max(limits.min, Math.min(limits.max, width))
            : value,
        ];
      }),
    ) as typeof defaults;
  } catch {
    return defaults;
  }
}

export function useWorkspaceLayout(details: boolean) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [available, setAvailable] = useState(window.innerWidth);
  const [preferred, setPreferred] = useState(readWidths);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0)
        setAvailable(entry.contentRect.width);
    });
    if (root) observer.observe(root);
    return () => observer.disconnect();
  }, [root]);
  const mobile = available < layout.sidebar.min + layout.chatMin;
  const overlay =
    available < layout.sidebar.min + layout.chatMin + layout.inspector.min;
  const right =
    details && !overlay
      ? Math.min(
          preferred.inspector,
          available - layout.sidebar.min - layout.chatMin,
        )
      : 0;
  const left = mobile
    ? 0
    : Math.min(preferred.sidebar, available - right - layout.chatMin);
  const widths = {
    sidebar: left || preferred.sidebar,
    inspector: right || preferred.inspector,
  };
  const maximum = {
    sidebar: Math.min(layout.sidebar.max, available - right - layout.chatMin),
    inspector: Math.min(
      layout.inspector.max,
      available - left - layout.chatMin,
    ),
  };
  function resize(side: Side, width: number, persist = false) {
    const next = { ...preferred, [side]: width };
    setPreferred(next);
    if (persist) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {}
    }
  }
  return { root, setRoot, mobile, overlay, widths, maximum, resize };
}
