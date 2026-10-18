import type { EngineId } from "@domos/agent/harness/types";
import { ChoiceCards } from "@domos/ui/choice";
import { ChoicePicker } from "@domos/ui/picker";
import { useEffect, useState } from "react";
import { client } from "../../client.ts";
import { EngineMark } from "./engine-mark.tsx";

export function EngineSelect({
  value,
  onChange,
  disabled,
  presentation = "menu",
  status,
}: {
  value: EngineId;
  onChange: (value: EngineId) => void;
  disabled?: boolean;
  presentation?: "menu" | "list";
  status?: string;
}) {
  const [providers, setProviders] = useState<
    Awaited<ReturnType<typeof client.engines.catalog>>
  >([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    void client.engines.catalog().then(
      (value) => {
        if (current) setProviders(value);
      },
      () => {
        if (current) setError("无法读取任务引擎。请重新连接。");
      },
    );
    return () => {
      current = false;
    };
  }, []);
  return (
    <div className="field">
      {presentation === "list" ? (
        <ChoiceCards
          label="任务引擎"
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          options={providers.map(({ id, name }) => ({
            value: id,
            label: name,
            icon: <EngineMark provider={id} />,
            status: id === value ? status : undefined,
          }))}
        />
      ) : (
        <>
          <span className="field-label">由谁处理任务</span>
          <ChoicePicker
            label="任务引擎"
            value={value}
            items={providers.map(({ id, name }) => ({
              value: id,
              label: name,
            }))}
            disabled={disabled || !providers.length}
            onValueChange={(value) => onChange(value as EngineId)}
          />
        </>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
