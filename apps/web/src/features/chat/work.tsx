import type { EngineRun } from "@domos/agent/harness/types";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { ScrollArea } from "@domos/ui/scroll-area";
import { StatusDot } from "@domos/ui/status-dot";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { StopIcon } from "@phosphor-icons/react/dist/csr/Stop";
import { WrenchIcon } from "@phosphor-icons/react/dist/csr/Wrench";
import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EngineMark } from "../bots/engine-mark.tsx";
import { useModelSettings } from "../models/model-state.ts";
import type { useChat } from "./use-chat.ts";
import { WorkDelegations } from "./work-delegations.tsx";
import { WorkEntry } from "./work-entry.tsx";
import { workTime, workTurns } from "./work-state.ts";
import "./work.css";

export function WorkPanel(
  chat: ReturnType<typeof useChat> & {
    botId: number;
    selectedRun?: string;
    onRunClose?: () => void;
    detailOnly?: boolean;
    runDetails?: ReactNode;
  },
) {
  const { view, connected, stopping, stop } = chat;
  const { profile } = useModelSettings(chat.botId);
  const modelName = (run: EngineRun | undefined) =>
    profile?.catalog
      .find((entry) => entry.id === run?.provider)
      ?.models.find((model) => model.id === run?.model)?.name ??
    run?.model ??
    "模型未提供";
  const [selected, setSelected] = useState<string | undefined>(
    chat.selectedRun,
  );
  useEffect(() => {
    if (chat.selectedRun) setSelected(chat.selectedRun);
  }, [chat.selectedRun]);
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
  useEffect(() => {
    if (
      selected &&
      (selected === turns.at(-1)?.id ||
        !turns.some((turn) => turn.id === selected)) &&
      view?.before &&
      !chat.loadingEarlier &&
      !chat.error
    )
      void chat.loadEarlier();
  }, [
    selected,
    turns,
    view?.before,
    chat.loadingEarlier,
    chat.loadEarlier,
    chat.error,
  ]);
  const elapsed = (
    record: { startedAt?: number; endedAt?: number },
    active = false,
  ) => workTime(record.startedAt, record.endedAt ?? (active ? now : undefined));
  return (
    <>
      {!chat.detailOnly && (
        <ScrollArea
          className="detail-scroll"
          viewportClassName="detail-content"
        >
          {view && !turns.length && (
            <p className="detail-note">开始对话后，这里会显示每轮工作记录。</p>
          )}
          {turns.length > 0 && (
            <div className="work-list">
              {turns.map((turn) => {
                const status =
                  turn.status === "failed"
                    ? ({ tone: "negative", label: "执行失败" } as const)
                    : turn.active
                      ? !connected ||
                        stopping ||
                        turn.status === "queued" ||
                        turn.status === "stopping" ||
                        view?.approvals?.length
                        ? ({ tone: "warning", label: "等待处理" } as const)
                        : ({ tone: "positive", label: "正在工作" } as const)
                      : undefined;
                return (
                  <article
                    className="work-row"
                    key={turn.id}
                    data-active={turn.active || undefined}
                  >
                    <Button
                      variant="ghost"
                      className="work-open"
                      aria-label={`查看工作记录：${turn.request || turn.title}`}
                      onClick={openRun(turn.id)}
                    >
                      <span className="work-mark">
                        {turn.author && (
                          <BotAvatar
                            botId={turn.author.botId}
                            seed={turn.author.avatar}
                            size="small"
                          />
                        )}
                        <span
                          className={
                            turn.author ? "work-harness-badge" : undefined
                          }
                        >
                          {turn.run ? (
                            <EngineMark provider={turn.run.provider} />
                          ) : (
                            <WrenchIcon />
                          )}
                        </span>
                        {status && <StatusDot {...status} />}
                      </span>
                      <span className="work-label">
                        <span title={modelName(turn.run)}>
                          {turn.author ? `${turn.author.name} · ` : ""}
                          {modelName(turn.run)}
                        </span>
                        <span className="work-activity" title={turn.title}>
                          {turn.active && !connected
                            ? "状态待更新"
                            : turn.title}
                        </span>
                      </span>
                      <time>{elapsed(turn, turn.active && connected)}</time>
                      <CaretRightIcon className="work-chevron" />
                    </Button>
                    {turn.active && (
                      <Button
                        variant="ghost"
                        size="icon-small"
                        className="work-stop"
                        aria-label="停止执行"
                        disabled={!connected}
                        pending={stopping || turn.status === "stopping"}
                        onClick={() => void stop(turn.sessionId)}
                      >
                        <StopIcon />
                      </Button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
          {view?.before && (
            <Button
              variant="ghost"
              pending={chat.loadingEarlier}
              onClick={() => void chat.loadEarlier()}
            >
              更早的工作记录
            </Button>
          )}
          {!!view?.delegations?.length && (
            <WorkDelegations
              items={view.delegations}
              activity={view.activity}
            />
          )}
        </ScrollArea>
      )}
      <Dialog
        open={Boolean(current)}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(undefined);
            chat.onRunClose?.();
          }
        }}
        title="工作记录"
        finalFocus={() => trigger.current}
      >
        {current && view && (
          <div className="work-detail">
            <header className="work-heading">
              <p className="work-request">{current.request}</p>
              <div className="work-meta">
                {current.run && (
                  <span>
                    {current.run.provider} · {modelName(current.run)}
                  </span>
                )}
                <span role="status">
                  {connected ? current.title : "连接中断"}
                </span>
                <time>{elapsed(current, current.active)}</time>
              </div>
            </header>
            {chat.runDetails}
            <ol className="work-timeline" aria-label="执行时间线">
              {current.items.map((item) => (
                <WorkEntry
                  key={item.id}
                  botId={item.message.sessionId ?? view.id}
                  item={item}
                />
              ))}
            </ol>
          </div>
        )}
      </Dialog>
    </>
  );
}
