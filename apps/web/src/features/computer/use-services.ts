import { useCallback, useEffect, useState } from "react";
import { client } from "../../client.ts";
import { userError } from "../user-error.ts";

export type ComputerService = "browser" | "desktop";
export const serviceLabels = { browser: "浏览器", desktop: "桌面" };

export function useComputerServices(botId: number, active = true) {
  const [state, setState] =
    useState<Awaited<ReturnType<typeof client.computer.services>>>();
  const [busy, setBusy] = useState<ComputerService>();
  const [error, setError] = useState<string>();
  const load = useCallback(
    (signal?: AbortSignal) => {
      setError(undefined);
      void client.computer
        .services({ botId }, { signal })
        .then(setState)
        .catch((cause) => {
          if (!signal?.aborted)
            setError(userError(cause, "无法读取电脑状态。请重试。"));
        });
    },
    [botId],
  );
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [active, load]);
  async function configure(
    service: ComputerService,
    enabled: boolean,
    install = false,
  ) {
    if (busy) return;
    setBusy(service);
    setError(undefined);
    try {
      setState(
        await client.computer.service({ botId, service, enabled, install }),
      );
    } catch (cause) {
      setError(userError(cause, "电脑服务未能连接。请重试。"));
    } finally {
      setBusy(undefined);
    }
  }
  return {
    state,
    busy,
    error,
    configure,
    reload: () => load(),
  };
}
