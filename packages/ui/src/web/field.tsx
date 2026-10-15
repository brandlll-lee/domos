import { Field } from "@base-ui/react/field";

export function TextField({
  label,
  value,
  onValueChange,
  multiline = false,
  required,
  maxLength,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  multiline?: boolean;
  required?: boolean;
  maxLength?: number;
}) {
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
      />
    </Field.Root>
  );
}
