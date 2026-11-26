import { type CSSProperties, useEffect, useRef } from "react";
import { EngineMark } from "../engine-mark.tsx";
import "./harness-constellation.css";

const providers: string[] = [
  "claude",
  "codex",
  "opencode",
  "antigravity",
  "grok",
  "cursor",
  "pi",
  "devin",
];

export function HarnessConstellation() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch" || reduced.matches) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        element.style.setProperty(
          "--pointer-x",
          String((event.clientX / innerWidth) * 2 - 1),
        );
        element.style.setProperty(
          "--pointer-y",
          String((event.clientY / innerHeight) * 2 - 1),
        );
      });
    };
    const reset = () => {
      cancelAnimationFrame(frame);
      element.style.setProperty("--pointer-x", "0");
      element.style.setProperty("--pointer-y", "0");
    };
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", reset);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", reset);
    };
  }, []);
  return (
    <div className="harness-constellation" ref={root} aria-hidden="true">
      {providers.map((provider, index) => (
        <div
          className="harness-orbit"
          key={provider}
          style={
            {
              "--entrance": `${index * 65}ms`,
              "--depth": index % 2 === 0 ? 1 : 0.65,
            } as CSSProperties
          }
        >
          <div className="harness-card">
            <EngineMark provider={provider} />
          </div>
        </div>
      ))}
    </div>
  );
}
