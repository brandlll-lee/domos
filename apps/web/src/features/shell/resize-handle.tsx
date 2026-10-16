import { layout } from "@domos/ui/tokens";
import { useRef } from "react";

export function ResizeHandle({
  side,
  width,
  min,
  max,
  onResize,
  onCommit,
}: {
  side: "sidebar" | "inspector";
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  onCommit: (width: number) => void;
}) {
  const drag = useRef<{ x: number; width: number; next: number } | null>(null);
  const direction =
    (side === "sidebar" ? 1 : -1) *
    (document.documentElement.dir === "rtl" ? -1 : 1);
  const clamp = (value: number) => Math.max(min, Math.min(max, value));
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
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width, next: width };
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        drag.current.next = clamp(
          drag.current.width + (event.clientX - drag.current.x) * direction,
        );
        onResize(drag.current.next);
      }}
      onPointerUp={(event) => {
        if (drag.current) onCommit(drag.current.next);
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        if (drag.current) onResize(drag.current.width);
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        if (drag.current) onResize(drag.current.width);
        drag.current = null;
      }}
      onKeyDown={(event) => {
        const next = {
          ArrowLeft: width - layout.resizeStep * direction,
          ArrowRight: width + layout.resizeStep * direction,
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
