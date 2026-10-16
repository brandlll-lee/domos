import type { ComputerStatus } from "@domos/agent/computer";
import { computerLabels } from "./copy.ts";

export function ComputerLocation({
  status,
  connected,
}: {
  status: ComputerStatus | null;
  connected: boolean;
}) {
  return (
    <div>
      <strong>
        {status ? computerLabels.boundary[status.boundary] : "暂不分配电脑"}
      </strong>
      <span>
        {connected && status
          ? computerLabels.state[status.state]
          : status
            ? "正在重连"
            : "按需分配"}
      </span>
    </div>
  );
}
