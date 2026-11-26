import { EngineMark } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { Disclosure } from "@domos/ui/disclosure";
import { Loading } from "@domos/ui/loading";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { ClockIcon } from "@phosphor-icons/react/dist/csr/Clock";
import { PauseIcon } from "@phosphor-icons/react/dist/csr/Pause";
import { StopIcon } from "@phosphor-icons/react/dist/csr/Stop";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type { ReactNode } from "react";
import "./work-timeline.css";

export type TimelineState =
  | "running"
  | "waiting"
  | "queued"
  | "stopping"
  | "ended"
  | "stopped"
  | "failed"
  | "uncertain"
  | "recorded"
  | "done";
export type TimelineStep = {
  id: string;
  title: string;
  state: TimelineState;
  label: string;
  time: string;
  duration: string;
  content: ReactNode;
};
export type TimelineRun = {
  id: string;
  title: string;
  startedAt?: number;
  state: TimelineState;
  label: string;
  duration: string;
  author?: ReactNode;
  harness?: string;
  model?: string;
  toolFailures?: number;
  steps?: TimelineStep[];
};

import { workGroups } from "./work-state.ts";

export function WorkNode({
  state,
  label,
  variant = "status",
}: {
  state: TimelineState;
  label: string;
  variant?: "ring" | "status";
}) {
  const Icon =
    state === "failed"
      ? XIcon
      : state === "uncertain"
        ? WarningCircleIcon
        : state === "waiting"
          ? PauseIcon
          : state === "stopped" || state === "stopping"
            ? StopIcon
            : state === "queued"
              ? ClockIcon
              : CheckIcon;
  return (
    <span
      className="execution-node"
      data-state={state}
      data-variant={variant}
      role="img"
      aria-label={label}
    >
      {variant === "ring" ? null : state === "running" ? (
        <Loading label={label} inline />
      ) : (
        <Icon aria-hidden="true" />
      )}
    </span>
  );
}

export function WorkModel({ run }: { run: TimelineRun }) {
  return (
    <span className="execution-model">
      {run.harness ? (
        <span
          className="execution-harness"
          role="img"
          aria-label={`Harness：${run.harness}`}
          title={run.harness}
        >
          <EngineMark provider={run.harness} />
        </span>
      ) : (
        <span>Harness 未记录 ·</span>
      )}
      <span title={run.model}>{run.model ?? "模型未记录"}</span>
    </span>
  );
}

export function live(state: TimelineState) {
  return ["running", "waiting", "queued", "stopping"].includes(state);
}
export function timelineLabel(run: TimelineRun, connected: boolean) {
  return !connected && live(run.state) ? "连接中断，状态待更新" : run.label;
}
export function WorkList({
  runs,
  today,
  connected,
  onOpen,
  onStop,
  stopping,
}: {
  runs: TimelineRun[];
  today: number;
  connected: boolean;
  onOpen: (
    id: string,
    event: import("react").MouseEvent<HTMLButtonElement>,
  ) => void;
  onStop?: (id: string) => void;
  stopping?: boolean;
}) {
  const label = (run: TimelineRun) => timelineLabel(run, connected);
  return (
    <>
      {!runs.length && (
        <p className="execution-empty">开始对话后，这里会显示工作记录。</p>
      )}
      {workGroups(runs, today).map(({ label: date, turns: records }) => (
        <section className="execution-group" key={date} aria-label={date}>
          <h3>{date}</h3>
          <ol className="execution-timeline">
            {records.map((run) => (
              <li
                key={run.id}
                className="execution-run work-row"
                data-active={live(run.state) || undefined}
                data-run-id={run.id}
                data-highlight={
                  run.state !== "queued" && run.state !== "recorded"
                }
              >
                <Button
                  variant="ghost"
                  className="execution-open work-open"
                  onClick={(event) => {
                    onOpen(run.id, event);
                  }}
                  aria-label={`查看工作记录：${run.title}`}
                >
                  <time
                    dateTime={
                      run.startedAt === undefined
                        ? undefined
                        : new Date(run.startedAt).toISOString()
                    }
                  >
                    {run.startedAt === undefined
                      ? "—"
                      : new Date(run.startedAt).toLocaleTimeString("zh-CN", {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}
                  </time>
                  <WorkNode
                    variant="ring"
                    state={
                      !connected && live(run.state) ? "uncertain" : run.state
                    }
                    label={label(run)}
                  />
                  <span className="execution-copy">
                    <strong className="work-subject">{run.title}</strong>
                    <WorkModel run={run} />
                    <span className="execution-meta">
                      <span data-state={run.state}>{label(run)}</span>
                      <span>· {run.duration}</span>
                    </span>
                    {run.author && (
                      <span className="execution-meta">{run.author}</span>
                    )}
                    {!!run.toolFailures && (
                      <span className="execution-tool-issue">
                        {run.toolFailures} 次工具调用失败
                      </span>
                    )}
                  </span>
                </Button>
                {live(run.state) && onStop && (
                  <Button
                    variant="ghost"
                    size="icon-small"
                    className="work-stop"
                    aria-label="停止执行"
                    disabled={!connected}
                    pending={stopping || run.state === "stopping"}
                    onClick={() => onStop(run.id)}
                  >
                    <StopIcon />
                  </Button>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}
export function WorkSummary({
  run,
  connected,
  onStop,
  stopping,
}: {
  run: TimelineRun;
  connected: boolean;
  onStop?: () => void;
  stopping?: boolean;
}) {
  return (
    <section className="execution-summary" aria-label="执行摘要">
      <h3>{run.title}</h3>
      <WorkModel run={run} />
      <div className="execution-meta">
        <WorkNode
          state={!connected && live(run.state) ? "uncertain" : run.state}
          label={timelineLabel(run, connected)}
        />
        <span role="status">{timelineLabel(run, connected)}</span>
        <span>· {run.duration}</span>
        {live(run.state) && onStop && (
          <Button
            variant="ghost"
            size="small"
            aria-label="停止执行"
            disabled={!connected}
            pending={stopping || run.state === "stopping"}
            onClick={onStop}
          >
            停止
          </Button>
        )}
      </div>
      {run.author && <p className="execution-meta">{run.author}</p>}
    </section>
  );
}
export function WorkStep({
  step,
  connected,
  open,
  onToggle,
  parentId,
}: {
  step: TimelineStep;
  connected: boolean;
  open?: boolean;
  onToggle?: import("react").ToggleEventHandler<HTMLDetailsElement>;
  parentId?: string;
}) {
  return (
    <li
      className="execution-step work-entry"
      data-state={step.state}
      data-parent={parentId}
      tabIndex={-1}
    >
      <WorkNode
        state={
          !connected && step.state === "running" ? "uncertain" : step.state
        }
        label={step.label}
      />
      <Disclosure
        open={open}
        onToggle={onToggle}
        label={
          <span className="execution-step-copy">
            <span className="execution-step-top">
              <strong>{step.title}</strong>
              <time>{step.time}</time>
            </span>
            <span className="execution-meta">
              <span data-state={step.state}>
                {!connected && step.state === "running"
                  ? "状态待更新"
                  : step.label}
              </span>
              <span>· {step.duration}</span>
            </span>
          </span>
        }
      >
        {open !== false && (
          <div className="execution-evidence work-operation-body">
            {step.content}
          </div>
        )}
      </Disclosure>
    </li>
  );
}
