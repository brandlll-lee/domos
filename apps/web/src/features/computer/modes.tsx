import { Button } from "@domos/ui/controls";
import "./style.css";

export function ComputerModes({
  value,
  disabled,
  canIsolate,
  onChange,
}: {
  value?: "shared" | "dedicated";
  disabled: boolean;
  canIsolate: boolean;
  onChange: (mode: "shared" | "dedicated") => void;
}) {
  return (
    <fieldset className="computer-options" aria-label="此 Bot 的工作环境">
      <Button
        type="button"
        variant="secondary"
        className="computer-option"
        aria-pressed={value === "shared"}
        disabled={disabled}
        onClick={() => onChange("shared")}
      >
        <strong>共享电脑</strong>
        <span>与其他 Bot 共用一台电脑。共享文件和工具权限。</span>
      </Button>
      <Button
        type="button"
        variant="secondary"
        className="computer-option"
        aria-pressed={value === "dedicated"}
        disabled={disabled || !canIsolate}
        onClick={() => onChange("dedicated")}
      >
        <strong>独立电脑</strong>
        <span>
          {canIsolate
            ? "只供此 Bot 使用。自动准备独立的容器和工作文件。"
            : "独立电脑需要先启用隔离环境。"}
        </span>
      </Button>
    </fieldset>
  );
}
