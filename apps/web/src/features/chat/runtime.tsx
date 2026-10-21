import type { EngineRuntimeState } from "@domos/agent/harness/types";
import { Button } from "@domos/ui/controls";
import { ActionMenu } from "@domos/ui/menu";
import { client } from "../../client.ts";
import { useWorkAction } from "../bots/details/use-bot-work.ts";

export function RuntimeStatus({
  botId,
  state,
  busy,
  onDraft,
}: {
  botId: number;
  state?: EngineRuntimeState;
  busy: boolean;
  onDraft: (text: string) => void;
}) {
  const action = useWorkAction();
  if (!state) return null;
  return (
    <section
      className="runtime-status detail-stack"
      aria-label="上下文状态"
      aria-live="polite"
    >
      <div className="form-actions">
        {(state.contextTokens !== undefined ||
          state.contextWindow !== undefined) && (
          <span className="activity-caption">
            上下文 {state.contextTokens?.toLocaleString() ?? "待更新"} /{" "}
            {state.contextWindow?.toLocaleString() ?? "未提供"} Token
          </span>
        )}
        {state.compaction && (
          <span className="activity-caption">
            {state.compaction === "running"
              ? "正在压缩…"
              : state.compaction === "completed"
                ? "压缩完成"
                : "压缩失败"}
          </span>
        )}
        {state.controls?.compact && (
          <ActionMenu
            label="上下文操作"
            disabled={busy || action.busy}
            items={[
              {
                label: "压缩上下文",
                onSelect: () =>
                  void action.run(["compact", botId], (requestId) =>
                    client.engines.compact({ botId, requestId }),
                  ),
              },
            ]}
          />
        )}
      </div>
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
      {action.error && (
        <p className="alert" role="alert">
          {action.error}
        </p>
      )}
    </section>
  );
}
