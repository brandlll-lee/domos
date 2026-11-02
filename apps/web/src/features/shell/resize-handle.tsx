import { layout } from "@domos/ui/tokens";
import { useCallback, useEffect, useRef } from "react";

export function ResizeHandle({
  side,
  width,
  min,
  max,
  onResize,
  onCommit,
  onToggle,
  onDragChange,
}: {
  side: "sidebar" | "inspector";
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  onCommit: (width: number) => void;
  onToggle?: () => void;
  onDragChange: (dragging: boolean, moving?: boolean) => void;
}) {
  const drag = useRef<{
    x: number;
    width: number;
    initial: number;
    next: number;
    scale: number;
    moving: boolean;
  } | null>(null);
  const frame = useRef<number | undefined>(undefined);
  const cancelFrame = useCallback(() => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
  }, []);
  useEffect(
    () => () => {
      cancelFrame();
      if (drag.current) onDragChange(false);
    },
    [cancelFrame, onDragChange],
  );
  const cancelDrag = () => {
    cancelFrame();
    if (!drag.current) return;
    if (drag.current.moving) {
      onResize(drag.current.initial);
    }
    onDragChange(false);
    drag.current = null;
  };
  const direction =
    (side === "sidebar" ? 1 : -1) *
    (document.documentElement.dir === "rtl" ? -1 : 1);
  const clamp = (value: number) => {
    if (side === "sidebar") {
      const threshold =
        width === layout.sidebar.compact
          ? Math.min(max, layout.sidebar.min + layout.resizeStep)
          : layout.sidebar.min - layout.resizeStep;
      if (value < threshold) return layout.sidebar.compact;
      return Math.max(layout.sidebar.min, Math.min(max, value));
    }
    return Math.max(min, Math.min(max, value));
  };
  return (
    <hr
      className="panel-resizer"
      data-side={side}
      tabIndex={0}
      aria-label={side === "sidebar" ? "调整联系人宽度" : "调整详情宽度"}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(width)}
      onDoubleClick={onToggle}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const panel = event.currentTarget.parentElement;
        if (!panel) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const current = parseFloat(getComputedStyle(panel).width);
        const scale = panel.getBoundingClientRect().width / current;
        drag.current = {
          x: event.clientX,
          width: current,
          initial: width,
          next: width,
          scale,
          moving: false,
        };
        onDragChange(true);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        if (!drag.current.moving && event.clientX === drag.current.x) return;
        drag.current.next = clamp(
          drag.current.width +
            ((event.clientX - drag.current.x) * direction) / drag.current.scale,
        );
        if (frame.current === undefined)
          frame.current = requestAnimationFrame(() => {
            frame.current = undefined;
            if (drag.current) {
              onResize(drag.current.next);
              if (!drag.current.moving) {
                drag.current.moving = true;
                onDragChange(true, true);
              }
            }
          });
      }}
      onPointerUp={(event) => {
        cancelFrame();
        if (
          drag.current &&
          (drag.current.moving || drag.current.next !== drag.current.initial)
        ) {
          onCommit(drag.current.next);
        }
        if (drag.current) onDragChange(false);
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={cancelDrag}
      onLostPointerCapture={cancelDrag}
      onKeyDown={(event) => {
        const step =
          event.key === "ArrowLeft"
            ? -layout.resizeStep * direction
            : layout.resizeStep * direction;
        const arrowWidth =
          side === "sidebar"
            ? width === layout.sidebar.compact && step > 0
              ? Math.min(max, layout.sidebar.min + layout.resizeStep)
              : width <= layout.sidebar.min && step < 0
                ? layout.sidebar.compact
                : width + step
            : width + step;
        const next = {
          ArrowLeft: arrowWidth,
          ArrowRight: arrowWidth,
          Home: min,
          End: max,
        }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        onCommit(clamp(next));
      }}
    />
  );
}
