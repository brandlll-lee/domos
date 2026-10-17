import { useCallback, useEffect, useState } from "react";
import { client } from "../../client.ts";
import type { useBots } from "../bots/use-bots.ts";

export function useComputer(
  botId: number,
  directory: Pick<ReturnType<typeof useBots>, "computers" | "updateComputers">,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] =
    useState<Awaited<ReturnType<typeof client.computer.setup>>>();
  const binding = directory.computers.bindings[String(botId)];
  const status =
    directory.computers.items.find((item) => item.id === binding?.computerId) ??
    null;
  const refresh = useCallback(async () => {
    const [catalog, location] = await Promise.all([
      client.computer.list(),
      client.computer.setup(),
    ]);
    directory.updateComputers(catalog);
    setSetup(location);
  }, [directory.updateComputers]);
  useEffect(() => {
    void refresh().catch((cause) => setError(cause.message));
  }, [refresh]);
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "电脑准备未完成。请重试。",
      );
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  const selection = () => ({
    botId,
    revision: binding?.revision ?? 0,
    requestId: crypto.randomUUID(),
  });
  return {
    status,
    busy,
    error,
    setup,
    refresh,
    choices: directory.computers.items.filter(
      (item) => item.scope?.kind !== "dedicated" || item.scope.botId === botId,
    ),
    assign: (computerId: string | null) =>
      run(() => client.computer.assign({ ...selection(), computerId })),
    prepare: (mode: "shared" | "dedicated") =>
      run(() => client.computer.prepare({ ...selection(), mode })),
  };
}
