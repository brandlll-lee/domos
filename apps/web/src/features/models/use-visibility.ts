import type { EngineId } from "@domos/agent/harness/types";
import { useState } from "react";
import { client } from "../../client.ts";
import { createReadState, useReadState } from "../read-state.ts";
import { userError } from "../user-error.ts";

const visibility = createReadState((signal) =>
  client.models.visibility(undefined, { signal }),
);
window.addEventListener("domos:computer", () => visibility.clear());
window.addEventListener("domos:pair", () => visibility.clear());

export function useVisibility(enabled: boolean) {
  const state = useReadState(visibility, enabled);
  const items = state.data ?? [];
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  return {
    error:
      error ||
      (state.error ? userError(state.error, "模型可见性读取失败。") : ""),
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
        visibility.receive(
          await client.models.setVisibility({ harness, model, visible }),
        );
      } catch (cause) {
        setError(userError(cause, "模型可见性保存失败。"));
      } finally {
        setPending(false);
      }
    },
  };
}
