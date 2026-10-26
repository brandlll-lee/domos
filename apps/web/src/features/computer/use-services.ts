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
    async changeMode(mode: "headless" | "headed") {
      if (busy) return false;
      setBusy("browser");
      setError(undefined);
      try {
        const next = await client.computer.browserMode({
          botId,
          mode,
          confirmRestart: true,
        });
        setState(next);
        if (!next.browser.available) {
          setError(next.browser.error ?? "浏览器未能启动。可以切换回原模式。");
          return false;
        }
        return true;
      } catch (cause) {
        setError(userError(cause, "浏览器模式切换失败。请检查工作电脑。"));
        return false;
      } finally {
        setBusy(undefined);
      }
    },
    reload: () => load(),
  };
}
