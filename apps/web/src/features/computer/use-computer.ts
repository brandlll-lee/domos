import { useState } from "react";
import { client } from "../../client.ts";
import type { useBots } from "../bots/use-bots.ts";

export function useComputer(
  botId: number,
  directory: Pick<ReturnType<typeof useBots>, "computers" | "updateComputers">,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const binding = directory.computers.bindings[String(botId)];
  const status =
    directory.computers.items.find((item) => item.id === binding?.computerId) ??
    null;
  async function assign(computerId: string | null) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await client.computer.assign({
        botId,
        computerId,
        revision: binding?.revision ?? 0,
        requestId: crypto.randomUUID(),
      });
      directory.updateComputers(await client.computer.list());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "分配未确认。请刷新后重试。",
      );
    } finally {
      setBusy(false);
    }
  }
  return { status, busy, error, assign, choices: directory.computers.items };
}
