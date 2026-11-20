import { useLayoutEffect, useRef } from "react";

export function NumberTicker({
  value,
  text,
}: {
  value: number | null;
  text: string;
}) {
  const display = useRef<HTMLSpanElement>(null);
  const previous = useRef<number | null>(null);
  useLayoutEffect(() => {
    const root = display.current;
    if (!root) return;
    const style = getComputedStyle(root);
    const size = Number.parseFloat(style.fontSize);
    const columns = new Map(
      [...root.querySelectorAll<HTMLElement>(".number-ticker-digit")].map(
        (column) => {
          const track = column.firstElementChild as HTMLElement;
          const position =
            Math.round(
              (-new DOMMatrixReadOnly(getComputedStyle(track).transform).f /
                size) *
                10000,
            ) / 10000;
          return [column.dataset.place, { column, track, position }];
        },
      ),
    );
    for (const animation of root.getAnimations({ subtree: true }))
      animation.cancel();
    const increasing =
      previous.current === null || value === null || value >= previous.current;
    previous.current = value;
    if (value === null) {
      root.replaceChildren(document.createTextNode(text));
      return;
    }
    let place = [...text].filter((character) => /\d/.test(character)).length;
    const children = [...text].map((character) => {
      if (!/\d/.test(character)) return document.createTextNode(character);
      const retained = columns.get(String(--place));
      const column = retained?.column ?? document.createElement("span");
      const track = retained?.track ?? document.createElement("span");
      if (!retained) {
        column.className = "number-ticker-digit";
        column.dataset.place = String(place);
        for (let index = 0; index < 30; index++) {
          const digit = document.createElement("span");
          digit.textContent = String(index % 10);
          track.append(digit);
        }
        column.append(track);
      }
      // The middle copy leaves a full cycle available in either direction.
      const start = retained ? 10 + (((retained.position % 10) + 10) % 10) : 10;
      const digit = Number(character);
      const target =
        digit +
        10 *
          (increasing
            ? Math.ceil((start - digit) / 10)
            : Math.floor((start - digit) / 10));
      const transform = `translateY(${-target}em)`;
      track.style.transform = transform;
      if (
        start !== target &&
        !document.hidden &&
        !matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        track.animate(
          [{ transform: `translateY(${-start}em)` }, { transform }],
          {
            duration: Number.parseFloat(
              style.getPropertyValue("--motion-data"),
            ),
            easing: style.getPropertyValue("--ease-message-in").trim(),
          },
        );
      }
      return column;
    });
    root.replaceChildren(...children);
  }, [value, text]);
  useLayoutEffect(() => {
    const root = display.current;
    const parent = root?.parentElement?.parentElement;
    if (!root || !parent) return;
    let layout = "";
    const fit = () => {
      const width = parent.clientWidth;
      const next = `${width}:${root.parentElement?.getAttribute("aria-label")}`;
      if (layout === next) return;
      layout = next;
      if (!width) return;
      root.style.fontSize = "";
      root.style.fontSize = `${Math.min(1, width / root.scrollWidth)}em`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(parent);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const root = display.current;
    const settle = () => {
      for (const animation of root?.getAnimations({ subtree: true }) ?? [])
        animation.cancel();
    };
    const visibility = () => {
      if (document.hidden) settle();
    };
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const motion = () => {
      if (reduced.matches) settle();
    };
    document.addEventListener("visibilitychange", visibility);
    reduced.addEventListener("change", motion);
    return () => {
      settle();
      document.removeEventListener("visibilitychange", visibility);
      reduced.removeEventListener("change", motion);
    };
  }, []);
  return (
    <span className="number-ticker" role="img" aria-label={text}>
      <span ref={display} aria-hidden="true" />
    </span>
  );
}
