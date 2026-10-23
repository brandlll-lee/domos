import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import type { ReactNode } from "react";

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
  return (
    <RadioGroup
      className="segmented-control"
      data-variant={variant}
      aria-label={label}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      {options.map((option) => (
        <Radio.Root
          className="segmented-option"
          key={option.value}
          value={option.value}
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
