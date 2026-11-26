import type { ChatMessage } from "@domos/agent/messages";
import { Button } from "@domos/ui/controls";
import { ActionMenu } from "@domos/ui/menu";
import { PanelHeader } from "@domos/ui/panel";
import { Popover } from "@domos/ui/popover";
import { ScrollArea } from "@domos/ui/scroll-area";
import { CrosshairIcon } from "@phosphor-icons/react/dist/csr/Crosshair";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import type { useChat } from "./use-chat.ts";
import { WorkDiagnostics } from "./work-diagnostics.tsx";
import { WorkEntry } from "./work-entry.tsx";
import { workTimeline, type workTurns } from "./work-state.ts";
import { WorkSummary } from "./work-timeline.tsx";

export function WorkDetail({
  turn,
  author,
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
  sessionId: number;
  connected: boolean;
  stopping: boolean;
  now: number;
  stop: ReturnType<typeof useChat>["stop"];
  onBack: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const summary = { ...workTimeline(turn, now), author: author?.name };
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
  const model = summary.model ?? "模型未记录";
  const provider = summary.harness;
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
        viewportClassName="execution-scroll work-content"
      >
        <WorkSummary
          run={summary}
          connected={connected}
          stopping={stopping}
          onStop={() => void stop(turn.sessionId)}
        />
        <ol
          ref={timeline}
          className="execution-timeline execution-steps"
          aria-label="执行时间线"
        >
          {turn.items.map((item) => (
            <WorkEntry
              key={item.id}
              botId={item.message.sessionId ?? sessionId}
              item={item}
              connected={connected}
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
                    {provider ?? "Harness 未记录"} · {model}
                  </p>
                  <p>
                    {date?.toLocaleString("zh-CN", dateOptions) ??
                      "开始时间未知"}
                    {end && ` – ${end.toLocaleString("zh-CN", dateOptions)}`}
                  </p>
                  {turn.run?.evidence?.toolCalls !== undefined && (
                    <p>{turn.run.evidence.toolCalls} 次工具调用</p>
                  )}
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
