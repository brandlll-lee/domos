import type { EngineRuntimeState } from "@domos/agent/harness/types";
import { Button } from "@domos/ui/controls";

export function RuntimeStatus({
  state,
  onDraft,
}: {
  state?: EngineRuntimeState;
  onDraft: (text: string) => void;
}) {
  return state?.editorText !== undefined ? (
    <Button
      size="small"
      variant="secondary"
      onClick={() => onDraft(state.editorText ?? "")}
    >
      使用扩展草稿
    </Button>
  ) : null;
}
