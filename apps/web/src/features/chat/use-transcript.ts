import { useEffect, useLayoutEffect, useRef, useState } from "react";

export function useTranscript(value: unknown) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const dimensions = useRef({ width: 0, height: 0, content: 0 });
  const [atBottom, setAtBottom] = useState(true);
  const jumpToLatest = () => {
    following.current = true;
    if (viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
    setAtBottom(true);
  };
  useLayoutEffect(() => {
    if (value && following.current && viewport.current) {
      viewport.current.scrollTop = viewport.current.scrollHeight;
      setAtBottom(true);
    }
  }, [value]);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (following.current && viewport.current)
        viewport.current.scrollTop = viewport.current.scrollHeight;
    });
    if (viewport.current) observer.observe(viewport.current);
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, []);
  return {
    viewport,
    content,
    atBottom,
    jumpToLatest,
    onScroll() {
      const element = viewport.current;
      if (!element) return;
      const next = {
        width: element.clientWidth,
        height: element.clientHeight,
        content: element.scrollHeight,
      };
      const resized =
        next.width !== dimensions.current.width ||
        next.height !== dimensions.current.height ||
        next.content !== dimensions.current.content;
      dimensions.current = next;
      if (resized && following.current) {
        element.scrollTop = element.scrollHeight;
        setAtBottom(true);
        return;
      }
      const bottom =
        Math.ceil(element.scrollTop + element.clientHeight) >=
        element.scrollHeight;
      following.current = bottom;
      setAtBottom(bottom);
    },
  };
}
