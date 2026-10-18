import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";

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
            <strong>{option.label}</strong>
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
