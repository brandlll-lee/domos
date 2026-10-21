import type { EngineRuntimeState } from "@domos/agent/harness/types";
import { ContextWindow } from "@domos/ui/context-window";
import { Button } from "@domos/ui/controls";
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
  const compaction = state.compactionDetails;
  const manual = state.contextPolicy?.manual ?? state.controls?.compact;
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
      <div className="form-actions">
        {(state.contextTokens !== undefined ||
          state.contextWindow !== undefined ||
          manual ||
          state.compaction) && (
          <ContextWindow
            used={state.contextTokens}
            capacity={state.contextWindow}
            estimated={state.context?.estimated}
          >
            <div className="context-window-details">
              <p className="context-window-note">
                {state.context?.basis === "last-input"
                  ? "最近一次模型输入，非累计用量。"
                  : "当前原生会话的上下文读数，非累计用量。"}
              </p>
              <p className="context-window-note">引擎未提供分类明细。</p>
              <p>
                自动压缩：
                {state.contextPolicy?.automatic === "enabled"
                  ? "已开启"
                  : state.contextPolicy?.automatic === "disabled"
                    ? "已关闭"
                    : state.contextPolicy?.automatic === "native"
                      ? "由引擎管理"
                      : "未提供"}
              </p>
              {state.compaction && <p role="status">{status}</p>}
              {compaction && (
                <p className="context-window-note">
                  压缩前 {compaction.beforeTokens?.toLocaleString() ?? "未提供"}{" "}
                  → 压缩后{" "}
                  {compaction.afterTokens?.toLocaleString() ?? "待更新"} Token
                </p>
              )}
              {compaction?.error && <p role="alert">{compaction.error}</p>}
              {manual && (
                <Button
                  size="small"
                  variant="secondary"
                  disabled={busy || action.busy}
                  onClick={() =>
                    void action.run(["compact", botId], (requestId) =>
                      client.engines.compact({ botId, requestId }),
                    )
                  }
                >
                  压缩上下文
                </Button>
              )}
              {state.context && (
                <details>
                  <summary>查看详细信息</summary>
                  <dl>
                    <dt>数据来源</dt>
                    <dd>{state.context.source}</dd>
                    <dt>模型</dt>
                    <dd>{state.context.model ?? "未提供"}</dd>
                    <dt>原生会话</dt>
                    <dd>{state.context.sessionId ?? "未提供"}</dd>
                    <dt>更新时间</dt>
                    <dd>
                      {new Date(state.context.observedAt).toLocaleString()}
                    </dd>
                  </dl>
                </details>
              )}
            </div>
          </ContextWindow>
        )}
        {state.compaction && <span className="activity-caption">{status}</span>}
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
