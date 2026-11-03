import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { Field } from "@base-ui/react/field";
import { type ComponentProps, type RefObject, useRef } from "react";
import { Button } from "./controls.tsx";

export function SearchField({
  value,
  onValueChange,
  className = "",
  inputRef,
  hidden,
  ...props
}: Omit<ComponentProps<"input">, "value" | "onChange" | "type" | "ref"> & {
  value: string;
  onValueChange: (value: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const local = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? local;
  return (
    <div className={`search-field ${className}`} hidden={hidden}>
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="8.5" cy="8.5" r="5.5" />
        <path d="m13 13 4 4" />
      </svg>
      <input
        {...props}
        ref={ref}
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      />
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon-small"
          disabled={props.disabled || props.readOnly}
          aria-label={`清除${props["aria-label"] ?? "搜索"}`}
          onClick={() => {
            onValueChange("");
            ref.current?.focus();
          }}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m6 6 8 8m0-8-8 8" />
          </svg>
        </Button>
      )}
    </div>
  );
}

export function TextField({
  label,
  value,
  onValueChange,
  multiline = false,
  required,
  maxLength,
  description,
  error,
  ...props
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  multiline?: boolean;
  required?: boolean;
  maxLength?: number;
  description?: string;
  error?: string;
} & Pick<
  ComponentProps<"input">,
  | "type"
  | "placeholder"
  | "minLength"
  | "autoComplete"
  | "pattern"
  | "disabled"
  | "autoFocus"
  | "inputMode"
  | "onKeyDown"
>) {
  return (
    <Field.Root className="field" invalid={Boolean(error) || undefined}>
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
      {description && (
        <Field.Description className="field-description">
          {description}
        </Field.Description>
      )}
      {error && (
        <Field.Error className="field-error" match>
          {error}
        </Field.Error>
      )}
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
