import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { Field } from "@base-ui/react/field";
import type { ComponentProps } from "react";

export function TextField({
  label,
  value,
  onValueChange,
  multiline = false,
  required,
  maxLength,
  ...props
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  multiline?: boolean;
  required?: boolean;
  maxLength?: number;
} & Pick<
  ComponentProps<"input">,
  "type" | "placeholder" | "minLength" | "autoComplete" | "pattern" | "disabled"
>) {
  return (
    <Field.Root className="field">
      <Field.Label className="field-label">{label}</Field.Label>
      <Field.Control
        className="field-control"
        value={value}
        onValueChange={onValueChange}
        required={required}
        maxLength={maxLength}
        render={multiline ? <textarea rows={4} /> : undefined}
        {...props}
      />
    </Field.Root>
  );
}

export function Checkbox({
  label,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Field.Root disabled={disabled}>
      <Field.Label className="checkbox-field">
        <BaseCheckbox.Root
          className="checkbox"
          nativeButton
          render={<button type="button" />}
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
        >
          <BaseCheckbox.Indicator className="checkbox-indicator">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m3.5 8 3 3 6-6" />
            </svg>
          </BaseCheckbox.Indicator>
        </BaseCheckbox.Root>
        {label}
      </Field.Label>
    </Field.Root>
  );
}
