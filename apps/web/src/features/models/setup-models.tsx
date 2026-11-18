import { Button } from "@domos/ui/controls";
import { useEffect, useEffectEvent, useRef, useState } from "react";

export function SetupModels({
  models,
  value,
  disabled,
  onSelect,
}: {
  models: { id: string; name: string }[];
  value: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const [browsed, setBrowsed] = useState<string>();
  const region = useRef<HTMLElement>(null);
  const current = Math.max(
    0,
    models.findIndex((model) => model.id === (browsed ?? value)),
  );
  const at = (step: number) =>
    models[(current + step + models.length) % models.length];
  const browse = (step: number) => {
    if (disabled || models.length < 2) return;
    setBrowsed(at(step)?.id);
    const element = region.current;
    element?.dispatchEvent(
      new CustomEvent("startup:browse", { detail: step, bubbles: true }),
    );
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const distance = element?.closest("[data-compact]") ? 71 : 85;
    for (const label of element?.querySelectorAll(".startup-model-name") ??
      []) {
      for (const animation of label.getAnimations()) animation.cancel();
      label.animate(
        [
          {
            transform: `translateY(${distance * step * 0.68}px)`,
            opacity: 0.15,
          },
          { transform: "translateY(0)", opacity: 1 },
        ],
        { duration: 240, easing: "cubic-bezier(.2,.73,.26,1)" },
      );
    }
  };
  const wheel = useEffectEvent(browse);
  useEffect(() => {
    const element = region.current;
    if (!element || models.length < 2 || disabled) return;
    let last = -Infinity;
    let remainder = 0;
    const scroll = (event: WheelEvent) => {
      if (event.ctrlKey || !event.deltaY) return;
      event.preventDefault();
      if (event.timeStamp - last < 210) return;
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
      if (Math.sign(remainder) !== Math.sign(delta)) remainder = 0;
      remainder += delta;
      if (Math.abs(remainder) < 22) return;
      last = event.timeStamp;
      wheel(Math.sign(remainder));
      remainder = 0;
    };
    element.addEventListener("wheel", scroll, { passive: false });
    return () => element.removeEventListener("wheel", scroll);
  }, [disabled, models.length]);
  return (
    <section
      ref={region}
      aria-label="模型"
      className="startup-branches startup-models"
      onKeyDown={(event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        browse(event.key === "ArrowUp" ? -1 : 1);
      }}
    >
      {[-1, 0, 1].map((step) => {
        const model =
          step === 0 || models.length > (step < 0 ? 2 : 1)
            ? at(step)
            : undefined;
        return model ? (
          <Button
            key={step}
            variant="ghost"
            className="startup-branch"
            data-model-step={step}
            aria-label={step ? `浏览 ${model.name}` : `确认模型 ${model.name}`}
            aria-current={step ? undefined : "true"}
            disabled={disabled}
            onClick={() => (step ? browse(step) : onSelect(model.id))}
          >
            <span className="startup-branch-copy">
              <strong className="startup-model-name">{model.name}</strong>
              {!step && model.id === value && <small>已选择</small>}
            </span>
            <span className="startup-arrow" aria-hidden="true">
              {step < 0 ? "↑" : step > 0 ? "↓" : "→"}
            </span>
          </Button>
        ) : null;
      })}
      {models.length > 1 && (
        <p className="startup-model-hint">↑ ↓ 滚动浏览 · Enter 确认</p>
      )}
    </section>
  );
}
