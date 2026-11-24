import type { EngineRun } from "@domos/agent/harness/types";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { ScrollArea } from "@domos/ui/scroll-area";
import { StatusDot } from "@domos/ui/status-dot";
import { CrosshairIcon } from "@phosphor-icons/react/dist/csr/Crosshair";
import { StopIcon } from "@phosphor-icons/react/dist/csr/Stop";
import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useModelSettings } from "../models/model-state.ts";
import type { useChat } from "./use-chat.ts";
import { WorkDelegations } from "./work-delegations.tsx";
import { WorkDiagnostics } from "./work-diagnostics.tsx";
import { WorkEntry } from "./work-entry.tsx";
import { workGroups, workTime, workTurns } from "./work-state.ts";
import "./work.css";

export function WorkPanel(
  chat: ReturnType<typeof useChat> & {
    botId: number;
    team?: boolean;
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
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (chat.selectedRun) {
      setSelected(chat.selectedRun);
      setClosing(false);
    }
  }, [chat.selectedRun]);
  const [now, setNow] = useState(Date.now);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const timeline = useRef<HTMLOListElement>(null);
  const openRun = (id: string) => (event: MouseEvent<HTMLButtonElement>) => {
    trigger.current = event.currentTarget;
    setClosing(false);
    setSelected(id);
  };
  useEffect(() => {
    if (!view?.busy) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [view?.busy]);
  const turns = useMemo(() => (view ? workTurns(view) : []), [view]);
  const groups = workGroups(turns, now);
  const current = turns.find((turn) => turn.id === selected);
  const problem =
    current?.items.findIndex(
      (item) => item.status === "failed" || item.status === "uncertain",
    ) ?? -1;
  const locateProblem = () => {
    const target = timeline.current?.children[problem] as
      | HTMLElement
      | undefined;
    target?.scrollIntoView({ block: "center" });
    target?.focus({ preventScroll: true });
  };
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
            <WorkDelegations
              items={view.delegations}
              activity={view.activity}
            />
          )}
        </ScrollArea>
      )}
      <Dialog
        open={Boolean(current) && !closing}
        onOpenChange={(open) => {
          setClosing(!open);
        }}
        onOpenChangeComplete={(open) => {
          if (!open) {
            setSelected(undefined);
            chat.onRunClose?.();
            setClosing(false);
          }
        }}
        title="工作记录"
        finalFocus={() => trigger.current}
        headerActions={
          current && (
            <>
              {problem >= 0 && (
                <Button
                  variant="ghost"
                  size="icon-small"
                  aria-label="定位问题"
                  title="定位问题"
                  onClick={locateProblem}
                >
                  <CrosshairIcon />
                </Button>
              )}
              <WorkDiagnostics key={current.id} run={current.run} />
            </>
          )
        }
      >
        {current && view && (
          <div className="work-detail">
            <header className="work-heading">
              <p className="work-request">
                {current.request || current.subject}
              </p>
              <div className="work-meta">
                {current.run && (
                  <span>
                    {current.run.provider} · {modelName(current.run)}
                  </span>
                )}
                <span role="status">
                  {current.active && !connected ? "状态待更新" : current.title}
                </span>
                <time>{elapsed(current, current.active)}</time>
              </div>
            </header>
            {chat.runDetails}
            <ol
              ref={timeline}
              className="work-timeline"
              aria-label="执行时间线"
            >
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
