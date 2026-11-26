import type { ChatMessage } from "@domos/agent/messages";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { Loading } from "@domos/ui/loading";
import { PanelHeader } from "@domos/ui/panel";
import { ScrollArea } from "@domos/ui/scroll-area";
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
import { workGroups, workTimeline, workTurns } from "./work-state.ts";
import { WorkList } from "./work-timeline.tsx";
import "./work.css";

export function WorkPanel(
  chat: ReturnType<typeof useChat> & {
    botId: number;
    team?: boolean;
    selectedRun?: string;
    onRunClose?: () => void;
    runDetails?: ReactNode;
    author?: ChatMessage["author"];
    onClose: () => void;
    onDetailChange: (open: boolean) => void;
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
  const detailOpen = selected !== undefined;
  useLayoutEffect(() => {
    chat.onDetailChange(detailOpen);
    return () => chat.onDetailChange(false);
  }, [chat.onDetailChange, detailOpen]);
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
    if (!view?.busy || !connected) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [view?.busy, connected]);
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
  const runs = groups
    .flatMap((group) => group.turns)
    .map((turn) => ({
      ...workTimeline(turn, now),
      author:
        chat.team && turn.author ? (
          <>
            <BotAvatar
              botId={turn.author.botId}
              seed={turn.author.avatar}
              size="small"
            />
            {turn.author.name}
          </>
        ) : undefined,
    }));
  const latest = runs[0]?.id;
  const previous = useRef(latest);
  const [hasNew, setHasNew] = useState(false);
  useEffect(() => {
    if (previous.current && latest && latest !== previous.current)
      setHasNew(true);
    previous.current = latest;
  }, [latest]);
  return (
    <>
      <ScrollArea
        hidden={selected !== undefined}
        viewportRef={viewport}
        className="detail-scroll"
        viewportClassName="execution-scroll"
      >
        {hasNew && (
          <Button
            variant="ghost"
            size="small"
            onClick={() => {
              viewport.current?.scrollTo({ top: 0 });
              setHasNew(false);
            }}
          >
            有新工作 · 查看最新记录
          </Button>
        )}
        {chat.error ? (
          <div role="alert">
            <p>{String(chat.error)}</p>
            <Button variant="ghost" onClick={() => void chat.reconnect()}>
              重新读取
            </Button>
          </div>
        ) : !view ? (
          <Loading label="正在读取工作记录" />
        ) : null}
        {view && (
          <WorkList
            runs={runs}
            today={now}
            connected={connected}
            stopping={stopping}
            onOpen={(id, event) => openRun(id)(event)}
            onStop={(id) =>
              void stop(turns.find((turn) => turn.id === id)?.sessionId)
            }
          />
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
          <WorkDelegations items={view.delegations} activity={view.activity} />
        )}
      </ScrollArea>
      {selected &&
        (current && view ? (
          <WorkDetail
            key={current.id}
            turn={current}
            author={current.author ?? chat.author}
            sessionId={view.id}
            connected={connected}
            stopping={stopping}
            now={now}
            stop={stop}
            onBack={closeRun}
            onClose={chat.onClose}
          >
            {chat.runDetails}
          </WorkDetail>
        ) : (
          <section className="work-detail" aria-label="工作记录">
            <PanelHeader
              title="工作记录"
              onBack={closeRun}
              backLabel="返回工作列表"
              onClose={chat.onClose}
            />
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
