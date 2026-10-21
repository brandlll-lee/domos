import type { EngineControls } from "@domos/agent/harness/types";
import { useState } from "react";

export function Effort({
  control,
  disabled,
  onChange,
}: {
  control: EngineControls["options"][number];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const initial = control.options.findIndex(
    (item) => item.id === control.value,
  );
  const [index, setIndex] = useState(initial < 0 ? 0 : initial);
  const [dirty, setDirty] = useState(false);
  const selected = control.options[index];
  if (!selected || control.options.length < 2) return null;
  const commit = () => {
    if (dirty && selected.id !== control.value) {
      setDirty(false);
      onChange(selected.id);
    }
  };
  return (
    <div className="model-effort">
      <div className="model-effort-labels">
        <span>更快</span>
        <span>更深入</span>
      </div>
      <div className="model-effort-track">
        <div className="model-effort-dots" aria-hidden="true">
          {control.options.map((item) => (
            <span key={item.id} />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={control.options.length - 1}
          step={1}
          value={index}
          aria-label={control.label}
          aria-valuetext={initial < 0 && !dirty ? "引擎默认" : selected.label}
          disabled={disabled}
          onChange={(event) => {
            setIndex(Number(event.target.value));
            setDirty(true);
          }}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
      </div>
      <div className="model-effort-labels">
        <span title={selected.label}>
          {initial < 0 && !dirty ? "引擎默认" : selected.label}
        </span>
        {selected.id === control.defaultValue && <span>推荐</span>}
      </div>
    </div>
  );
}
