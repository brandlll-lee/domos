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
    if (!disabled) setBrowsed(at(step)?.id);
  };
  const wheel = useEffectEvent(browse);
  useEffect(() => {
    const element = region.current;
    if (!element || models.length < 2 || disabled) return;
    let last = -Infinity;
    const scroll = (event: WheelEvent) => {
      if (event.ctrlKey || !event.deltaY) return;
      event.preventDefault();
      if (event.timeStamp - last < 180) return;
      last = event.timeStamp;
      wheel(Math.sign(event.deltaY));
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
              <strong>{model.name}</strong>
              {!step && model.id === value && <small>已选择</small>}
            </span>
            <span aria-hidden="true">
              {step < 0 ? "↑" : step > 0 ? "↓" : "→"}
            </span>
          </Button>
        ) : (
          <div className="startup-model-space" key={step} />
        );
      })}
    </section>
  );
}
