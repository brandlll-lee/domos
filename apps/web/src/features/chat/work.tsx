import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { Loading } from "@domos/ui/loading";
import { ScrollArea } from "@domos/ui/scroll-area";
import { StatusDot } from "@domos/ui/status-dot";
import { StopIcon } from "@phosphor-icons/react/dist/csr/Stop";
import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { useChat } from "./use-chat.ts";
import { WorkDelegations } from "./work-delegations.tsx";
import { WorkDetail } from "./work-detail.tsx";
import { workGroups, workTime, workTurns } from "./work-state.ts";
import "./work.css";

export function WorkPanel(
  chat: ReturnType<typeof useChat> & {
    botId: number;
    team?: boolean;
    selectedRun?: string;
    onRunClose?: () => void;
    runDetails?: ReactNode;
  },
) {
  const { view, connected, stopping, stop } = chat;
  const [selected, setSelected] = useState<string | undefined>(
    chat.selectedRun,
  );
  useEffect(() => {
    if (chat.selectedRun) {
      setSelected(chat.selectedRun);
    }
  }, [chat.selectedRun]);
  const [now, setNow] = useState(Date.now);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const reading = useRef(0);
  const returning = useRef(false);
  const openRun = (id: string) => (event: MouseEvent<HTMLButtonElement>) => {
    trigger.current = event.currentTarget;
    reading.current = viewport.current?.scrollTop ?? 0;
    setSelected(id);
  };
  const closeRun = () => {
    returning.current = true;
    setSelected(undefined);
    chat.onRunClose?.();
  };
  useLayoutEffect(() => {
    if (selected || !returning.current) return;
    returning.current = false;
    if (viewport.current) viewport.current.scrollTop = reading.current;
    trigger.current?.focus({ preventScroll: true });
  }, [selected]);
  useEffect(() => {
    if (!view?.busy) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [view?.busy]);
  const turns = useMemo(() => (view ? workTurns(view) : []), [view]);
  const groups = workGroups(turns, now);
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
      <ScrollArea
        hidden={selected !== undefined}
        viewportRef={viewport}
        className="detail-scroll"
        viewportClassName="detail-content"
      >
        {view && !turns.length && (
          <p className="detail-note">开始对话后，这里会显示每轮工作记录。</p>
        )}
        {groups.map((group) => (
          <section
            className="work-group"
            key={group.label}
            aria-label={group.label}
          >
            <h3>{group.label}</h3>
            <div className="work-list">
              {group.turns.map((turn) => {
                const status =
                  turn.issue === "failed"
                    ? ({ tone: "negative", label: "执行失败" } as const)
                    : turn.issue === "uncertain"
                      ? ({ tone: "warning", label: "结果待核对" } as const)
                      : turn.active
                        ? ({
                            tone:
                              !connected || !turn.working
                                ? "warning"
                                : "positive",
                            label: turn.title,
                          } as const)
                        : undefined;
                const date =
                  turn.startedAt === undefined
                    ? undefined
                    : new Date(turn.startedAt);
                return (
                  <article
                    className="work-row"
                    key={turn.id}
                    data-active={turn.active || undefined}
                  >
                    <Button
                      variant="ghost"
                      className="work-open"
                      aria-label={`查看工作记录：${turn.request || turn.subject}`}
                      onClick={openRun(turn.id)}
                    >
                      {turn.active ? (
                        <span className="work-time">进行中</span>
                      ) : (
                        <time
                          className="work-time"
                          dateTime={date?.toISOString()}
                          title={date?.toLocaleString("zh-CN")}
                        >
                          {date?.toLocaleTimeString("zh-CN", {
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                          }) ?? "—"}
                        </time>
                      )}
                      <span className="work-label">
                        <span className="work-subject" title={turn.subject}>
                          {turn.subject}
                        </span>
                        {chat.team && turn.author && (
                          <span className="work-author">
                            <BotAvatar
                              botId={turn.author.botId}
                              seed={turn.author.avatar}
                              size="small"
                            />
                            {turn.author.name}
                          </span>
                        )}
                        <span
                          className="work-activity"
                          data-tone={status?.tone}
                        >
                          {status && <StatusDot {...status} />}
                          <span>
                            {turn.active && !connected
                              ? "状态待更新"
                              : turn.title}
                          </span>
                          <span>
                            · {turn.active ? "已运行 " : ""}
                            {elapsed(turn, turn.active && connected)}
                          </span>
                        </span>
                      </span>
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
          </section>
        ))}
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
          <WorkDelegations items={view.delegations} activity={view.activity} />
        )}
      </ScrollArea>
      {selected &&
        (current && view ? (
          <WorkDetail
            key={current.id}
            turn={current}
            botId={chat.botId}
            team={chat.team}
            sessionId={view.id}
            connected={connected}
            stopping={stopping}
            now={now}
            stop={stop}
            onBack={closeRun}
          >
            {chat.runDetails}
          </WorkDetail>
        ) : (
          <section className="work-detail" aria-label="工作记录">
            <Button variant="ghost" onClick={closeRun}>
              返回工作列表
            </Button>
            {chat.error ? (
              <p role="alert">{String(chat.error)}</p>
            ) : view && !view.before ? (
              <p>未找到这条工作记录。</p>
            ) : (
              <Loading label="正在读取工作记录" />
            )}
          </section>
        ))}
    </>
  );
}
