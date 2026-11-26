import type { ChatMessage } from "@domos/agent/messages";
import { BotAvatar, EngineMark } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { ActionMenu } from "@domos/ui/menu";
import { PanelHeader } from "@domos/ui/panel";
import { Popover, Tooltip } from "@domos/ui/popover";
import { ScrollArea } from "@domos/ui/scroll-area";
import { CrosshairIcon } from "@phosphor-icons/react/dist/csr/Crosshair";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { StopIcon } from "@phosphor-icons/react/dist/csr/Stop";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { useModelSettings } from "../models/model-state.ts";
import type { useChat } from "./use-chat.ts";
import { WorkDiagnostics } from "./work-diagnostics.tsx";
import { WorkEntry } from "./work-entry.tsx";
import { workTime, type workTurns } from "./work-state.ts";

export function WorkDetail({
  turn,
  author,
  botId,
  sessionId,
  connected,
  stopping,
  now,
  stop,
  onBack,
  onClose,
  children,
}: {
  turn: ReturnType<typeof workTurns>[number];
  author?: ChatMessage["author"];
  botId: number;
  sessionId: number;
  connected: boolean;
  stopping: boolean;
  now: number;
  stop: ReturnType<typeof useChat>["stop"];
  onBack: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const { profile } = useModelSettings(botId);
  const back = useRef<HTMLButtonElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const timeline = useRef<HTMLOListElement>(null);
  const [info, setInfo] = useState("执行详情");
  const [infoOpen, setInfoOpen] = useState(false);
  useLayoutEffect(() => back.current?.focus({ preventScroll: true }), []);
  const problem = turn.items.findIndex(
    (item) => item.status === "failed" || item.status === "uncertain",
  );
  const date =
    turn.startedAt === undefined ? undefined : new Date(turn.startedAt);
  const end = turn.endedAt === undefined ? undefined : new Date(turn.endedAt);
  const model =
    profile?.catalog
      .find((entry) => entry.id === turn.run?.provider)
      ?.models.find((model) => model.id === turn.run?.model)?.name ??
    turn.run?.model ??
    "模型未知";
  const provider =
    profile?.providers.find((item) => item.id === turn.run?.provider)?.name ??
    turn.run?.provider;
  const dateOptions = {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  } as const;
  return (
    <section className="work-detail" aria-label="工作记录">
      <PanelHeader
        title="工作记录"
        onBack={onBack}
        backLabel="返回工作列表"
        backRef={back}
        onClose={onClose}
        actions={
          <>
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
            <ActionMenu
              label="工作记录选项"
              trigger={
                <Button
                  ref={more}
                  variant="ghost"
                  size="icon-small"
                  aria-label="工作记录选项"
                >
                  <DotsThreeIcon />
                </Button>
              }
              items={["执行详情", "诊断信息"].map((label) => ({
                label,
                onSelect: () => {
                  setInfo(label);
                  setInfoOpen(true);
                },
              }))}
            />
          </>
        }
      />
      <ScrollArea
        className="detail-scroll"
        viewportClassName="detail-content work-content"
      >
        <section className="work-summary" aria-label="执行摘要">
          {author && (
            <BotAvatar botId={author.botId} seed={author.avatar} size="large" />
          )}
          <div className="work-summary-copy">
            <h3 title={author?.name}>{author?.name ?? "执行者未知"}</h3>
            <div className="work-model">
              {turn.run && (
                <Tooltip.Root>
                  <Tooltip.Trigger
                    render={<Button variant="ghost" size="icon-small" />}
                    aria-label={`Harness：${turn.run.provider}`}
                  >
                    <EngineMark provider={turn.run.provider} />
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Positioner
                      className="tooltip-positioner"
                      sideOffset={6}
                    >
                      <Tooltip.Popup className="tooltip-surface">
                        {provider}
                      </Tooltip.Popup>
                    </Tooltip.Positioner>
                  </Tooltip.Portal>
                </Tooltip.Root>
              )}
              <span title={model}>{model}</span>
            </div>
            <div className="work-summary-status">
              <span role="status">
                {turn.active && !connected ? "状态待更新" : turn.title}
              </span>
              <span>
                ·{" "}
                {workTime(
                  turn.startedAt,
                  turn.endedAt ?? (turn.active && connected ? now : undefined),
                )}
              </span>
              {turn.run?.evidence?.toolCalls !== undefined && (
                <span>· {turn.run.evidence.toolCalls} 次工具调用</span>
              )}
            </div>
            <div className="work-dates">
              <time dateTime={date?.toISOString()}>
                {date?.toLocaleString("zh-CN", dateOptions) ?? "开始时间未知"}
              </time>
              {end && (
                <>
                  <span>–</span>
                  <time dateTime={end.toISOString()}>
                    {end.toLocaleString(
                      "zh-CN",
                      date?.toDateString() === end.toDateString()
                        ? { hour: "2-digit", minute: "2-digit", hour12: false }
                        : dateOptions,
                    )}
                  </time>
                </>
              )}
            </div>
          </div>
        </section>
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
      <Popover.Root open={infoOpen} onOpenChange={setInfoOpen}>
        <Popover.Portal>
          <Popover.Positioner
            anchor={more}
            className="popover-positioner"
            side="bottom"
            align="end"
            sideOffset={8}
            collisionPadding={12}
          >
            <Popover.Popup
              className="popover-surface work-diagnostics"
              finalFocus={more}
            >
              <Popover.Title>{info}</Popover.Title>
              {info === "诊断信息" ? (
                <WorkDiagnostics run={turn.run} />
              ) : (
                <>
                  <p className="work-request">{turn.request || turn.subject}</p>
                  <p>
                    {provider ?? "Harness 未知"} · {model}
                  </p>
                  {children}
                </>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </section>
  );
}
