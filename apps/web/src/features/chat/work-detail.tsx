import { Button } from "@domos/ui/controls";
import { Disclosure } from "@domos/ui/disclosure";
import { ScrollArea } from "@domos/ui/scroll-area";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { CrosshairIcon } from "@phosphor-icons/react/dist/csr/Crosshair";
import { StopIcon } from "@phosphor-icons/react/dist/csr/Stop";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { useModelSettings } from "../models/model-state.ts";
import type { useChat } from "./use-chat.ts";
import { WorkDiagnostics } from "./work-diagnostics.tsx";
import { WorkEntry } from "./work-entry.tsx";
import { workTime, type workTurns } from "./work-state.ts";

export function WorkDetail({
  turn,
  botId,
  sessionId,
  connected,
  stopping,
  now,
  stop,
  onBack,
  children,
  team,
}: {
  turn: ReturnType<typeof workTurns>[number];
  botId: number;
  sessionId: number;
  connected: boolean;
  stopping: boolean;
  now: number;
  stop: ReturnType<typeof useChat>["stop"];
  onBack: () => void;
  children?: ReactNode;
  team?: boolean;
}) {
  const { profile } = useModelSettings(botId);
  const back = useRef<HTMLButtonElement>(null);
  const timeline = useRef<HTMLOListElement>(null);
  useLayoutEffect(() => back.current?.focus({ preventScroll: true }), []);
  const problem = turn.items.findIndex(
    (item) => item.status === "failed" || item.status === "uncertain",
  );
  const date =
    turn.startedAt === undefined ? undefined : new Date(turn.startedAt);
  const model =
    profile?.catalog
      .find((entry) => entry.id === turn.run?.provider)
      ?.models.find((model) => model.id === turn.run?.model)?.name ??
    turn.run?.model ??
    "模型未提供";
  return (
    <section className="work-detail" aria-label="工作记录">
      <div className="work-toolbar">
        <Button
          ref={back}
          variant="ghost"
          onClick={onBack}
          aria-label="返回工作列表"
        >
          <ArrowLeftIcon />
          工作记录
        </Button>
        <div className="work-actions">
          {turn.active && (
            <Button
              variant="ghost"
              size="icon-small"
              aria-label="停止执行"
              disabled={!connected}
              pending={stopping || turn.status === "stopping"}
              onClick={() => void stop(turn.sessionId)}
            >
              <StopIcon />
            </Button>
          )}
          {problem >= 0 && (
            <Button
              variant="ghost"
              size="icon-small"
              aria-label="定位问题"
              onClick={() => {
                const target = timeline.current?.children[problem] as
                  | HTMLElement
                  | undefined;
                const detail = target?.querySelector("details");
                if (detail) detail.open = true;
                target?.scrollIntoView({ block: "center" });
                target?.focus({ preventScroll: true });
              }}
            >
              <CrosshairIcon />
            </Button>
          )}
          <WorkDiagnostics run={turn.run} />
        </div>
      </div>
      <ScrollArea className="detail-scroll" viewportClassName="detail-content">
        <header className="work-heading">
          <h3 className="work-request">{turn.subject}</h3>
          <div className="work-meta">
            <span role="status">
              {turn.active && !connected ? "状态待更新" : turn.title}
            </span>
            <span>
              {workTime(
                turn.startedAt,
                turn.endedAt ?? (turn.active && connected ? now : undefined),
              )}
            </span>
          </div>
          <div className="work-meta">
            <time dateTime={date?.toISOString()}>
              {date?.toLocaleString("zh-CN") ?? "开始时间未提供"}
            </time>
            {turn.endedAt !== undefined && (
              <time dateTime={new Date(turn.endedAt).toISOString()}>
                至 {new Date(turn.endedAt).toLocaleTimeString("zh-CN")}
              </time>
            )}
          </div>
          {team && turn.author && (
            <span className="work-meta">{turn.author.name}</span>
          )}
          <Disclosure label="任务输入">
            <p className="work-request">{turn.request || turn.subject}</p>
            {turn.run && (
              <span className="work-meta">
                {turn.run.provider} · {model}
              </span>
            )}
            {children}
          </Disclosure>
        </header>
        <ol ref={timeline} className="work-timeline" aria-label="执行时间线">
          {turn.items.map((item) => (
            <WorkEntry
              key={item.id}
              botId={item.message.sessionId ?? sessionId}
              item={item}
            />
          ))}
        </ol>
      </ScrollArea>
    </section>
  );
}
