import type { EngineRuntimeState } from "@domos/agent/harness/types";
import { Button } from "@domos/ui/controls";

export function RuntimeStatus({
  state,
  onDraft,
}: {
  state?: EngineRuntimeState;
  onDraft: (text: string) => void;
}) {
  if (!state) return null;
  const status =
    state.compaction === "running"
      ? "正在压缩…"
      : state.compaction === "completed"
        ? "压缩完成"
        : state.compaction === "uncertain"
          ? "压缩结果未确认"
          : "压缩失败";
  return (
    <section
      className="runtime-status detail-stack"
      aria-label="上下文状态"
      aria-live="polite"
    >
      {state.compaction && <span className="activity-caption">{status}</span>}
      {Object.entries(state.notices ?? {})
        .filter(([, text]) => text)
        .map(([id, text]) => (
          <p className="detail-note approval-detail" key={id}>
            {text}
          </p>
        ))}
      {state.editorText !== undefined && (
        <Button
          size="small"
          variant="secondary"
          onClick={() => onDraft(state.editorText ?? "")}
        >
          使用扩展草稿
        </Button>
      )}
    </section>
  );
}
