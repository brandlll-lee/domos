import { ActivityDetails } from "@domos/ui/activity";
import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { ScrollArea } from "@domos/ui/scroll-area";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { BrainIcon } from "@phosphor-icons/react/dist/csr/Brain";
import { StopIcon } from "@phosphor-icons/react/dist/csr/Stop";
import { WrenchIcon } from "@phosphor-icons/react/dist/csr/Wrench";
import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { EngineMark } from "../bots/engine-mark.tsx";
import { Attachments } from "./attachments.tsx";
import { MessageContent } from "./message-content.tsx";
import type { useChat } from "./use-chat.ts";
import { workStatus, workTime, workTurns } from "./work-state.ts";
import "./work.css";

export function WorkPanel(chat: ReturnType<typeof useChat>) {
  const { view, connected, stopping, stop } = chat;
  const [selected, setSelected] = useState<string>();
  const [now, setNow] = useState(Date.now);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const openRun = (id: string) => (event: MouseEvent<HTMLButtonElement>) => {
    trigger.current = event.currentTarget;
    setSelected(id);
  };
  useEffect(() => {
    if (!view?.busy) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [view?.busy]);
  const turns = useMemo(() => (view ? workTurns(view) : []), [view]);
  const current = turns.find((turn) => turn.id === selected);
  const elapsed = (
    record: { startedAt?: number; endedAt?: number },
    active = false,
  ) => workTime(record.startedAt, record.endedAt ?? (active ? now : undefined));
  return (
    <>
      <ScrollArea className="detail-scroll" viewportClassName="detail-content">
        {!connected && (
          <p role="status" className="detail-note">
            连接中断，显示最后收到的状态。
          </p>
        )}
        {view && !turns.length && (
          <p className="detail-note">开始对话后，这里会显示每轮工作记录。</p>
        )}
        {turns.map((turn) => (
          <article
            className="work-card"
            key={turn.id}
            data-running={turn.active || undefined}
          >
            <Button
              variant="ghost"
              className="work-open"
              type="button"
              aria-label={`查看工作记录：${turn.request || turn.title}`}
              onClick={openRun(turn.id)}
            >
              <div className="work-heading">
                <span className="work-mark">
                  {turn.run ? (
                    <EngineMark provider={turn.run.provider} />
                  ) : (
                    <WrenchIcon />
                  )}
                </span>
                <span title={turn.title}>{turn.title}</span>
                <time>{elapsed(turn, turn.active)}</time>
              </div>
              <div className="work-meta">
                <span>{turn.run?.model ?? "模型未提供"}</span>
                <span>
                  {turn.plan.length
                    ? `步骤 ${turn.plan.filter((step) => step.status === "completed").length}/${turn.plan.length}`
                    : `已记录 ${turn.items.filter((item) => item.kind === "toolCall").length} 项操作`}
                </span>
              </div>
              <div
                className="work-progress"
                role="img"
                aria-label={turn.plan.length ? "原生计划进度" : "执行状态"}
              >
                {turn.plan.length ? (
                  turn.plan.map((step) => (
                    <span
                      key={step.step}
                      title={step.step}
                      data-state={step.status}
                    />
                  ))
                ) : (
                  <span
                    data-state={turn.active ? "indeterminate" : "settled"}
                  />
                )}
              </div>
              <ul className="work-items">
                {turn.items.slice(-5).map((item) => (
                  <li key={item.id}>
                    {item.kind === "thinking" ? <BrainIcon /> : <WrenchIcon />}
                    <span title={item.label}>{item.label}</span>
                    <time>
                      {elapsed(item, turn.active && item.status === "running")}
                    </time>
                  </li>
                ))}
              </ul>
            </Button>
            <footer className="work-actions">
              {turn.active && (
                <Button
                  variant="secondary"
                  disabled={!connected}
                  pending={stopping || turn.status === "stopping"}
                  onClick={() => void stop()}
                >
                  <StopIcon />
                  Stop
                </Button>
              )}
              <Button
                variant="ghost"
                size="small"
                className="work-run"
                type="button"
                onClick={openRun(turn.id)}
              >
                Open run <ArrowUpRightIcon />
              </Button>
            </footer>
          </article>
        ))}
      </ScrollArea>
      <Dialog
        open={Boolean(current)}
        onOpenChange={(open) => {
          if (!open) setSelected(undefined);
        }}
        title="工作记录"
        className="work-dialog"
        finalFocus={() => trigger.current}
      >
        {current && view && (
          <div className="work-detail">
            <p className="work-request">{current.request}</p>
            <div className="work-meta">
              <span>
                {current.run?.provider ?? "Harness 未提供"} ·{" "}
                {current.run?.model ?? "模型未提供"}
              </span>
              <time>{elapsed(current, current.active)}</time>
            </div>
            <p role="status">
              {connected ? current.title : "连接中断，显示最后收到的状态"}
            </p>
            <p className="detail-note">
              时间按事件接收时间记录。
              {!current.run && "旧记录未保存完整执行元数据。"}
            </p>
            {!current.items.some((item) => item.kind === "thinking") && (
              <p className="detail-note">Harness 未提供思考内容。</p>
            )}
            {current.items.map((item) => (
              <ActivityDetails
                key={item.id}
                label={item.label}
                status={`${workStatus(item.status)} · ${elapsed(item, current.active && item.status === "running")}`}
                attention={item.status === "failed"}
              >
                {typeof item.detail === "string" ? (
                  <pre>{item.detail}</pre>
                ) : (
                  <MessageContent content={item.detail} />
                )}
                {item.result && (
                  <MessageContent content={item.result.content} />
                )}
                {item.result?.attachments?.length ? (
                  <Attachments
                    botId={view.id}
                    files={item.result.attachments}
                  />
                ) : null}
              </ActivityDetails>
            ))}
          </div>
        )}
      </Dialog>
    </>
  );
}
