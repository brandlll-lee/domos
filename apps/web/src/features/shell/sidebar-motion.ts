import { useCallback, useEffect, useRef } from "react";
import { flushSync } from "react-dom";

const movers =
  ".bot-avatar, .sidebar-toolbar button, .sidebar-footer button, .environment-trigger, .panel-resizer";
const labels =
  ".chat-preview, .sidebar-heading, .apps-trigger span, .conversation-children, .bot-conversation-actions";

export function useSidebarMotion(root: HTMLDivElement | null) {
  const running = useRef<(() => void) | null>(null);
  const finish = useCallback(() => running.current?.(), []);
  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const visibility = () => {
      if (document.hidden) finish();
    };
    window.addEventListener("resize", finish);
    document.addEventListener("visibilitychange", visibility);
    reduced.addEventListener("change", finish);
    return () => {
      finish();
      window.removeEventListener("resize", finish);
      document.removeEventListener("visibilitychange", visibility);
      reduced.removeEventListener("change", finish);
    };
  }, [finish]);

  function change(commit: () => void) {
    const panel = root?.querySelector<HTMLElement>(
      '.workspace-panel[data-side="sidebar"]',
    );
    const main = root?.querySelector<HTMLElement>(".workspace-content");
    if (
      !root ||
      !panel ||
      !main ||
      root.hasAttribute("data-mobile") ||
      document.hidden ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      finish();
      commit();
      return;
    }
    const beforeMain = main.getBoundingClientRect();
    const before = new Map(
      Array.from(panel.querySelectorAll<HTMLElement>(movers), (node) => [
        node,
        node.getBoundingClientRect(),
      ]),
    );
    const text = Array.from(
      panel.querySelectorAll<HTMLElement>(labels),
      (node) => ({
        node,
        box: node.getBoundingClientRect(),
        opacity: getComputedStyle(node).opacity,
      }),
    );
    finish();
    flushSync(commit);
    const afterMain = main.getBoundingClientRect();
    const rtl = getComputedStyle(root).direction === "rtl";
    const delta = rtl
      ? beforeMain.right - afterMain.right
      : beforeMain.left - afterMain.left;
    if (Math.abs(delta) < 0.5) return;
    const style = getComputedStyle(root);
    const timing = {
      duration: Number.parseFloat(
        style.getPropertyValue("--motion-message-in"),
      ),
      easing: style.getPropertyValue("--ease-message-in").trim(),
    };
    const animations: Animation[] = [];
    const restore: (() => void)[] = [];
    const box = panel.getBoundingClientRect();
    const handle = panel.querySelector<HTMLElement>(".panel-resizer");
    const hit = (handle?.getBoundingClientRect().width ?? 0) / 2;
    panel.setAttribute("data-morphing", "");
    panel.style.setProperty(
      "--sidebar-motion-width",
      `${rtl ? box.right - Math.min(beforeMain.right, afterMain.right) : Math.max(beforeMain.left, afterMain.left) - box.left}px`,
    );
    animations.push(
      main.animate(
        [{ transform: `translateX(${delta}px)` }, { transform: "none" }],
        timing,
      ),
      panel.animate(
        [
          {
            clipPath: rtl
              ? `inset(0 0 0 ${delta - hit}px)`
              : `inset(0 ${-delta - hit}px 0 0)`,
          },
          {
            clipPath: rtl ? `inset(0 0 0 ${-hit}px)` : `inset(0 ${-hit}px 0 0)`,
          },
        ],
        timing,
      ),
    );
    for (const [node, from] of before) {
      const to = node.getBoundingClientRect();
      if (!from.width || !to.width) continue;
      animations.push(
        node.animate(
          [
            {
              transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)`,
            },
            { transform: "none" },
          ],
          timing,
        ),
      );
    }
    const compact = root.hasAttribute("data-sidebar-compact");
    for (const { node, box, opacity } of text) {
      if (compact && box.width) {
        const saved = node.style.cssText;
        Object.assign(node.style, {
          position: "fixed",
          display: node.matches(".chat-preview") ? "grid" : "block",
          left: `${box.left}px`,
          top: `${box.top}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
          margin: "0",
          visibility: "visible",
          translate: "none",
          pointerEvents: "none",
          transition: "none",
        });
        restore.push(() => {
          node.style.cssText = saved;
        });
      }
      animations.push(
        node.animate([{ opacity }, { opacity: compact ? 0 : 1 }], {
          ...timing,
          fill: "both",
        }),
      );
    }
    const settle = () => {
      for (const animation of animations) animation.cancel();
      for (const reset of restore) reset();
      panel.removeAttribute("data-morphing");
      panel.style.removeProperty("--sidebar-motion-width");
      running.current = null;
    };
    running.current = settle;
    void Promise.all(animations.map((animation) => animation.finished)).then(
      () => {
        if (running.current === settle) settle();
      },
      () => {},
    );
  }
  return { change, finish };
}
