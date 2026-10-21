import type { EngineId } from "@domos/agent/harness/types";
import { useEffect, useState } from "react";
import { client } from "../../client.ts";
import { userError } from "../user-error.ts";

export function useVisibility(enabled: boolean) {
  const [items, setItems] = useState<
    Awaited<ReturnType<typeof client.models.visibility>>
  >([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const load = () =>
      void client.models
        .visibility(undefined, { signal: controller.signal })
        .then(setItems, (cause) => {
          if (!controller.signal.aborted)
            setError(userError(cause, "模型可见性读取失败。"));
        });
    load();
    window.addEventListener("domos:models", load);
    return () => {
      controller.abort();
      window.removeEventListener("domos:models", load);
    };
  }, [enabled]);
  return {
    error,
    pending,
    visible: (harness: EngineId, model: string) =>
      !items.some(
        (item) =>
          item.harness === harness && item.model === model && !item.visible,
      ),
    async save(harness: EngineId, model: string, visible: boolean) {
      setPending(true);
      setError("");
      try {
        setItems(
          await client.models.setVisibility({ harness, model, visible }),
        );
        window.dispatchEvent(new Event("domos:models"));
      } catch (cause) {
        setError(userError(cause, "模型可见性保存失败。"));
      } finally {
        setPending(false);
      }
    },
  };
}
