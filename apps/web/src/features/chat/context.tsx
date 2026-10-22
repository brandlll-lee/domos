import type { EngineId, EngineRuntimeState } from "@domos/agent/harness/types";
import { ContextWindow, contextPercent } from "@domos/ui/context-window";
import { Button } from "@domos/ui/controls";
import { client } from "../../client.ts";
import { useWorkAction } from "../bots/details/use-bot-work.ts";
import { EngineMark } from "../bots/engine-mark.tsx";

const compactNumber = (value: number) =>
  new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

const automaticLabel = (state: EngineRuntimeState) =>
  state.contextPolicy?.automatic === "enabled"
    ? "已开启"
    : state.contextPolicy?.automatic === "disabled"
      ? "已关闭"
      : state.contextPolicy?.automatic === "native"
        ? "由引擎管理"
        : "未提供";

export function ContextRing({
  botId,
  state,
  provider,
  busy,
}: {
  botId: number;
  state?: EngineRuntimeState;
  provider: EngineId;
  busy: boolean;
}) {
  const action = useWorkAction();
  const used = state?.contextTokens;
  const capacity = state?.contextWindow;
  const percent = contextPercent(used, capacity);
  const manual = state?.contextPolicy?.manual ?? state?.controls?.compact;
  const compaction = state?.compactionDetails;
  const status =
    state?.compaction === "running"
      ? "正在压缩…"
      : state?.compaction === "completed"
        ? "压缩完成"
        : state?.compaction === "uncertain"
          ? "压缩结果未确认"
          : "压缩失败";
  const free =
    used != null && capacity != null ? Math.max(0, capacity - used) : null;
  const summary =
    percent == null
      ? "上下文窗口"
      : `上下文 ${percent.toFixed(1)}% · 剩余 ${free == null ? "—" : compactNumber(free)}`;
  return (
    <ContextWindow
      used={used}
      capacity={capacity}
      estimated={state?.context?.estimated}
      trigger={
        <button
          type="button"
          className="context-ring"
          data-level={percent != null && percent >= 90 ? "high" : undefined}
          aria-label="上下文窗口"
          title={summary}
        >
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <circle className="context-ring-track" cx="16" cy="16" r="13.5" />
            {percent != null && (
              <circle
                className="context-ring-arc"
                cx="16"
                cy="16"
                r="13.5"
                pathLength={100}
                strokeDasharray={`${percent} 100`}
              />
            )}
          </svg>
          <EngineMark provider={provider} />
        </button>
      }
    >
      <div className="context-window-footer">
        {state?.compaction && (
          <p className="context-window-status" role="status">
            {status}
          </p>
        )}
        {compaction && (
          <p className="context-window-meta">
            {compaction.beforeTokens?.toLocaleString() ?? "未提供"} →{" "}
            {compaction.afterTokens?.toLocaleString() ?? "待更新"} Token
          </p>
        )}
        {compaction?.error && (
          <p className="context-window-status" role="alert">
            {compaction.error}
          </p>
        )}
        {action.error && (
          <p className="context-window-status" role="alert">
            {action.error}
          </p>
        )}
        <div className="context-window-actions">
          <p className="context-window-meta">
            自动压缩{state ? automaticLabel(state) : "未提供"}
          </p>
          {manual && (
            <Button
              className="context-window-action"
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
        </div>
      </div>
    </ContextWindow>
  );
}
