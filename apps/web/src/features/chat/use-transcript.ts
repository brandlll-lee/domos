import type { TranscriptItem } from "@domos/agent/transcript";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const pageSize = 120;
const keyOf = (item: TranscriptItem) => `${item.kind}:${item.id}`;
const incoming = (item: TranscriptItem) =>
  item.kind === "attachments" ||
  (item.kind === "message" && item.message.role === "assistant");

export function useTranscript(items: TranscriptItem[], ready: boolean) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const frame = useRef<number | undefined>(undefined);
  const measure = useRef(() => {});
  const previous = useRef<{
    items: TranscriptItem[];
    ready: boolean;
    width: number;
    height: number;
    padding: number;
  }>({
    items: [],
    ready: false,
    width: 0,
    height: 0,
    padding: 0,
  });
  const received = useRef<TranscriptItem[] | null>(null);
  const ownedTop = useRef(0);
  const scrolled = useRef(false);
  const jumping = useRef(false);
  const anchor = useRef<{ key: string; top: number } | null>(null);
  const reply = useRef<string | null>(null);
  const [range, setRange] = useState<{ start: number; end: number } | null>(
    null,
  );
  const [atBottom, setAtBottom] = useState(true);
  const [unread, setUnread] = useState(false);
  const start = range?.start ?? Math.max(0, items.length - pageSize);
  const end = range?.end ?? items.length;
  const visible = items.slice(start, end);
  const schedule = useCallback(() => {
    if (frame.current !== undefined) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      measure.current();
    });
  }, []);

  useLayoutEffect(() => {
    if (
      received.current &&
      !document.hidden &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      const known = new Set(received.current.map(keyOf));
      const arrivals = new Set(
        items
          .filter((item) => incoming(item) && !known.has(keyOf(item)))
          .map(keyOf),
      );
      for (const node of Array.from(content.current?.children ?? [])) {
        if (
          !(node instanceof HTMLElement) ||
          !arrivals.has(node.dataset.transcriptKey ?? "")
        )
          continue;
        node.dataset.arrival = "true";
        node.addEventListener(
          "animationend",
          () => {
            delete node.dataset.arrival;
          },
          { once: true },
        );
      }
    }
    received.current = ready ? items : null;
    measure.current = () => {
      const element = viewport.current;
      const list = content.current;
      if (!element || !list || !ready) return;
      const nodes = new Map(
        Array.from(list.children).flatMap((child) =>
          child instanceof HTMLElement && child.dataset.transcriptKey
            ? [[child.dataset.transcriptKey, child] as const]
            : [],
        ),
      );
      const old = previous.current;
      const seen = new Set(old.items.map(keyOf));
      const added =
        old.ready && old.items !== items
          ? items.filter((item) => incoming(item) && !seen.has(keyOf(item)))
          : [];
      const style = getComputedStyle(element);
      const top = Number.parseFloat(style.paddingTop);
      const bottom = Number.parseFloat(style.paddingBottom);
      const bounds = element.getBoundingClientRect();
      if (
        scrolled.current &&
        old.width === element.clientWidth &&
        old.height === element.clientHeight &&
        old.padding === bottom &&
        Math.abs(element.scrollTop - ownedTop.current) > 1
      ) {
        following.current =
          element.scrollHeight - element.clientHeight - element.scrollTop <= 2;
        reply.current = null;
        if (!following.current && !range) setRange({ start, end });
        if (following.current && range && end === items.length) setRange(null);
      }
      scrolled.current = false;
      let target = element.scrollTop;
      if (!old.ready || jumping.current) {
        target = element.scrollHeight;
        following.current = true;
        reply.current = null;
        jumping.current = false;
        setUnread(false);
      } else if (anchor.current) {
        const node = nodes.get(anchor.current.key);
        if (node)
          target += node.getBoundingClientRect().top - anchor.current.top;
        anchor.current = null;
      } else if (added.length && following.current) {
        const first = added.map((item) => nodes.get(keyOf(item))).find(Boolean);
        const lastItem = added.at(-1);
        const last = lastItem ? nodes.get(keyOf(lastItem)) : undefined;
        if (
          first &&
          last &&
          last.getBoundingClientRect().bottom -
            first.getBoundingClientRect().top >
            element.clientHeight - top - bottom
        ) {
          reply.current = first.dataset.transcriptKey ?? null;
          target += first.getBoundingClientRect().top - bounds.top - top;
          following.current = false;
          if (!range) setRange({ start, end });
        } else target = element.scrollHeight;
      } else if (added.length) setUnread(true);
      else if (following.current) target = element.scrollHeight;
      else if (reply.current) {
        const node = nodes.get(reply.current);
        if (node) target += node.getBoundingClientRect().top - bounds.top - top;
      }
      if (target !== element.scrollTop) element.scrollTop = target;
      ownedTop.current = element.scrollTop;
      const bottomReached =
        element.scrollHeight - element.clientHeight - element.scrollTop <= 2;
      setAtBottom(bottomReached && end === items.length);
      if (bottomReached && end === items.length) setUnread(false);
      previous.current = {
        items,
        ready,
        width: element.clientWidth,
        height: element.clientHeight,
        padding: bottom,
      };
    };
    schedule();
  }, [items, ready, range, start, end, schedule]);

  useEffect(() => {
    const observer = new ResizeObserver(schedule);
    if (viewport.current) observer.observe(viewport.current);
    if (content.current) observer.observe(content.current);
    return () => {
      observer.disconnect();
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    };
  }, [schedule]);

  return {
    viewport,
    content,
    visible,
    hasEarlier: start > 0,
    atBottom,
    unread,
    onScroll() {
      scrolled.current = true;
      schedule();
    },
    jumpToLatest() {
      following.current = true;
      jumping.current = true;
      setRange(null);
      schedule();
    },
    loadEarlier() {
      const first = content.current?.querySelector<HTMLElement>(
        "[data-transcript-key]",
      );
      if (first?.dataset.transcriptKey)
        anchor.current = {
          key: first.dataset.transcriptKey,
          top: first.getBoundingClientRect().top,
        };
      following.current = false;
      reply.current = null;
      setRange({
        start: Math.max(0, start - pageSize),
        end: Math.min(items.length, start + pageSize),
      });
    },
  };
}
