import { layout } from "@domos/ui/tokens";
import { startTransition, useEffect, useState } from "react";

type Side = "sidebar" | "inspector";
const storageKey = "domos:layout:v1";
const defaults = {
  sidebar: layout.sidebar.initial as number,
  inspector: layout.inspector.initial as number,
  collapsed: false,
};

function readWidths() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    return {
      ...Object.fromEntries(
        (["sidebar", "inspector"] as const).map((key) => {
          const value = defaults[key];
          const limits = layout[key];
          const width = saved?.[key];
          return [
            key,
            typeof width === "number" && Number.isFinite(width)
              ? Math.max(limits.min, Math.min(limits.max, width))
              : value,
          ];
        }),
      ),
      collapsed: saved?.collapsed === true,
    } as typeof defaults;
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
  const compact = !mobile && preferred.collapsed;
  const sidebarMin = compact ? layout.sidebar.compact : layout.sidebar.min;
  const overlay =
    available < sidebarMin + layout.chatMin + layout.inspector.min;
  const right =
    details && !overlay
      ? Math.min(preferred.inspector, available - sidebarMin - layout.chatMin)
      : 0;
  const left = mobile
    ? 0
    : Math.min(
        compact ? layout.sidebar.compact : preferred.sidebar,
        available - right - layout.chatMin,
      );
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
    const collapsed =
      side === "sidebar"
        ? width === layout.sidebar.compact
        : preferred.collapsed;
    const next = {
      ...preferred,
      ...(side !== "sidebar" || !collapsed ? { [side]: width } : {}),
      collapsed,
    };
    if (
      next.sidebar !== preferred.sidebar ||
      next.inspector !== preferred.inspector ||
      next.collapsed !== preferred.collapsed
    ) {
      if (persist) startTransition(() => setPreferred(next));
      else setPreferred(next);
    }
    if (persist) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {}
    }
  }
  return {
    root,
    setRoot,
    mobile,
    compact,
    overlay,
    widths,
    maximum,
    resize,
    toggleSidebar: () =>
      resize(
        "sidebar",
        compact ? preferred.sidebar : layout.sidebar.compact,
        true,
      ),
    expandSidebar: () => resize("sidebar", preferred.sidebar, true),
  };
}
