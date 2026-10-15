import { Combobox } from "@base-ui/react/combobox";
import { Select } from "@base-ui/react/select";
import { useMemo } from "react";

type Choice = { value: string; label: string };
type PickerProps = {
  label: string;
  value: string;
  items: Choice[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
};

function Caret() {
  return <span className="picker-caret" aria-hidden="true" />;
}

function Check() {
  return <span aria-hidden="true">✓</span>;
}

export function ChoicePicker({
  label,
  value,
  items,
  onValueChange,
  disabled,
}: PickerProps) {
  return (
    <Select.Root
      items={items}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
    >
      <Select.Trigger className="picker-trigger" aria-label={label}>
        <Select.Value className="picker-value" />
        <Select.Icon>
          <Caret />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          className="picker-positioner"
          align="end"
          sideOffset={6}
          alignItemWithTrigger={false}
        >
          <Select.Popup className="picker-popup" aria-label={label}>
            <Select.List className="picker-list">
              {items.map((item) => (
                <Select.Item
                  key={item.value}
                  value={item.value}
                  className="picker-item"
                >
                  <Select.ItemText>{item.label}</Select.ItemText>
                  <Select.ItemIndicator className="picker-check">
                    <Check />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

export function SearchPicker({
  label,
  value,
  items,
  onValueChange,
  disabled,
  readOnly,
  placeholder,
  searchLabel,
  emptyLabel,
}: PickerProps & {
  placeholder: string;
  readOnly?: boolean;
  searchLabel: string;
  emptyLabel: string;
}) {
  const collection = useMemo(
    () =>
      Combobox.createItems(items, {
        getValue: (item) => item.value,
        getLabel: (item) => item.label,
      }),
    [items],
  );
  return (
    <Combobox.Root
      items={collection}
      value={value}
      disabled={disabled}
      readOnly={readOnly}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
    >
      <Combobox.Trigger className="picker-trigger" aria-label={label}>
        <Combobox.Value>
          {(selected: string | null) => (
            <span className="picker-value">
              {items.find((item) => item.value === selected)?.label ??
                placeholder}
            </span>
          )}
        </Combobox.Value>
        <Combobox.Icon>
          <Caret />
        </Combobox.Icon>
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner
          className="picker-positioner"
          align="end"
          sideOffset={6}
        >
          <Combobox.Popup
            className="picker-popup picker-search-popup"
            aria-label={label}
          >
            <Combobox.Input
              className="picker-search"
              aria-label={searchLabel}
              placeholder={searchLabel}
            />
            <div className="picker-viewport">
              <Combobox.Empty>
                <div className="picker-empty">{emptyLabel}</div>
              </Combobox.Empty>
              <Combobox.List className="picker-list">
                {(item: Choice) => (
                  <Combobox.Item
                    key={item.value}
                    value={item.value}
                    className="picker-item"
                  >
                    <span>{item.label}</span>
                    <Combobox.ItemIndicator className="picker-check">
                      <Check />
                    </Combobox.ItemIndicator>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </div>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
