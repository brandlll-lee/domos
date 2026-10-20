import { Button } from "@domos/ui/controls";
import {
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export function MessageBody({ children }: { children: ReactNode }) {
  const id = useId();
  const frame = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    if (!frame.current || !body.current) return;
    const threshold = Number.parseFloat(
      getComputedStyle(frame.current).maxHeight,
    );
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setLong(entry.contentRect.height > threshold);
    });
    observer.observe(body.current);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <div
        id={id}
        ref={frame}
        className="message-body"
        data-folded={(long && !expanded) || undefined}
        data-expanded={expanded || undefined}
        onFocusCapture={() => {
          if (long) setExpanded(true);
        }}
      >
        <div ref={body}>{children}</div>
      </div>
      {long && (
        <Button
          className="message-expand"
          variant="ghost"
          size="small"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "收起" : "展开"}
        </Button>
      )}
    </>
  );
}
