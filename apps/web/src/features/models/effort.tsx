import type { EngineControls } from "@domos/agent/harness/types";
import { SegmentedControl } from "@domos/ui/choice";

export function Effort({
  control,
  disabled,
  onChange,
}: {
  control: EngineControls["options"][number];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  if (control.options.length < 2) return null;
  const labels: Record<string, string> = {
    off: "关闭",
    minimal: "最少",
    low: "低",
    medium: "中",
    high: "高",
    xhigh: "极高",
    max: "最高",
  };
  return (
    <div className="model-effort">
      <SegmentedControl
        label={control.label}
        variant="compact"
        value={control.value ?? ""}
        disabled={disabled}
        onValueChange={onChange}
        options={[
          { value: "", label: "默认" },
          ...control.options.map((item) => ({
            value: item.id,
            label: labels[item.id] ?? item.label,
          })),
        ]}
      />
    </div>
  );
}
