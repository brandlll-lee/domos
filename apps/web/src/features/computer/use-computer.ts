import type { ComputerStatus } from "@domos/agent/computer";
import { useState } from "react";
import { client } from "../../client.ts";

export function useComputer(
  botId: number,
  status: ComputerStatus | null,
  setStatus: (value: ComputerStatus) => void,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action?: "start" | "stop" | "rebuild") {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setStatus(
        action
          ? await client.computer.manage({ botId, action })
          : await client.computer.get({ botId }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "操作未确认。请刷新状态。",
      );
    } finally {
      setBusy(false);
    }
  }
  return { status, busy, error, run };
}
