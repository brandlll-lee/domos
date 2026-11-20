import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { type ReactNode, useLayoutEffect, useRef } from "react";

export function SegmentedControl<Value extends string>({
  label,
  value,
  onValueChange,
  options,
  disabled,
  variant = "pill",
}: {
  label: string;
  value: Value;
  onValueChange: (value: Value) => void;
  options: readonly { value: Value; label: string; title?: string }[];
  disabled?: boolean;
  variant?: "pill" | "compact";
}) {
  const root = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  const animation = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const group = root.current;
    const marker = indicator.current;
    if (!group || !marker) return;
    const elements = options.map((option) =>
      group.querySelector<HTMLElement>(
        `[data-value="${CSS.escape(option.value)}"]`,
      ),
    );
    const selected =
      elements[options.findIndex((option) => option.value === value)];
    const position = (animate: boolean) => {
      if (!selected?.offsetWidth) {
        marker.style.visibility = "hidden";
        animation.current?.cancel();
        return;
      }
      const width = selected.offsetWidth;
      const height = selected.offsetHeight;
      const transform = `translate3d(${selected.offsetLeft}px, ${selected.offsetTop}px, 0px)`;
      if (
        marker.style.transform === transform &&
        marker.style.width === `${width}px` &&
        marker.style.height === `${height}px` &&
        marker.style.visibility === "visible"
      )
        return;
      const current =
        marker.style.visibility === "visible"
          ? new DOMMatrixReadOnly(getComputedStyle(marker).transform)
          : null;
      const previousWidth = marker.offsetWidth;
      const previousHeight = marker.offsetHeight;
      animation.current?.cancel();
      Object.assign(marker.style, {
        width: `${width}px`,
        height: `${height}px`,
        transform,
        visibility: "visible",
      });
      if (
        animate &&
        current &&
        !matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        const style = getComputedStyle(group);
        animation.current = marker.animate(
          [
            {
              transform: `translate3d(${current.e}px, ${current.f}px, 0px) scale(${(current.a * previousWidth) / width}, ${(current.d * previousHeight) / height})`,
            },
            { transform },
          ],
          {
            duration: Number.parseFloat(
              style.getPropertyValue("--motion-feedback"),
            ),
            easing: style.getPropertyValue("--ease-message-in").trim(),
          },
        );
      }
    };
    position(true);
    const observer = new ResizeObserver(() => position(false));
    observer.observe(group);
    for (const option of elements) if (option) observer.observe(option);
    return () => observer.disconnect();
  }, [value, options]);
  useLayoutEffect(() => () => animation.current?.cancel(), []);
  return (
    <RadioGroup
      ref={root}
      className="segmented-control"
      data-variant={variant}
      aria-label={label}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      <span
        className="segmented-indicator"
        ref={indicator}
        aria-hidden="true"
      />
      {options.map((option) => (
        <Radio.Root
          className="segmented-option"
          key={option.value}
          value={option.value}
          data-value={option.value}
          title={option.title}
        >
          {option.label}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}

export function ChoiceCards<Value extends string>({
  label,
  value,
  onValueChange,
  options,
  disabled,
}: {
  label: string;
  value: Value;
  onValueChange: (value: Value) => void;
  options: readonly {
    value: Value;
    label: string;
    icon?: ReactNode;
    description?: string;
    status?: string;
    disabled?: boolean;
  }[];
  disabled?: boolean;
}) {
  return (
    <RadioGroup
      className="choice-list"
      aria-label={label}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      {options.map((option) => (
        <Radio.Root
          className="choice-card"
          key={option.value}
          value={option.value}
          disabled={option.disabled}
        >
          <span className="choice-content">
            <strong>
              {option.icon}
              {option.label}
            </strong>
            {option.description && (
              <span className="choice-description">{option.description}</span>
            )}
          </span>
          {option.status && (
            <span className="status-label">{option.status}</span>
          )}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}
