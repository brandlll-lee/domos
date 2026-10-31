import type { EngineRun } from "@domos/agent/harness/types";
import { ActivityDetails } from "@domos/ui/activity";
import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { ScrollArea } from "@domos/ui/scroll-area";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { StopIcon } from "@phosphor-icons/react/dist/csr/Stop";
import { WrenchIcon } from "@phosphor-icons/react/dist/csr/Wrench";
import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { EngineMark } from "../bots/engine-mark.tsx";
import { useModelSettings } from "../models/model-state.ts";
import { Attachments } from "./attachments.tsx";
import { MessageContent } from "./message-content.tsx";
import { MessageDetail } from "./message-detail.tsx";
import type { useChat } from "./use-chat.ts";
import { workStatus, workTime, workTurns } from "./work-state.ts";
import "./work.css";

export function WorkPanel(
  chat: ReturnType<typeof useChat> & {
    botId: number;
    selectedRun?: string;
    onRunClose?: () => void;
    detailOnly?: boolean;
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
          {!connected && (
            <p role="status" className="detail-note">
              连接中断，显示最后收到的状态。
            </p>
          )}
          {view && !turns.length && (
            <p className="detail-note">开始对话后，这里会显示每轮工作记录。</p>
          )}
          {turns.length > 0 && (
            <div className="work-list">
              {turns.map((turn) => (
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
                    <span
                      className="work-mark"
                      data-state={
                        turn.status === "failed"
                          ? "failed"
                          : turn.active
                            ? !connected ||
                              stopping ||
                              turn.status === "stopping" ||
                              view?.approvals?.length
                              ? "waiting"
                              : "running"
                            : undefined
                      }
                    >
                      {turn.run ? (
                        <EngineMark provider={turn.run.provider} />
                      ) : (
                        <WrenchIcon />
                      )}
                    </span>
                    <span className="work-label">
                      <span title={modelName(turn.run)}>
                        {modelName(turn.run)}
                      </span>
                      <span className="work-activity" title={turn.title}>
                        {turn.title}
                      </span>
                    </span>
                    <time>{elapsed(turn, turn.active)}</time>
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
                      onClick={() => void stop()}
                    >
                      <StopIcon />
                    </Button>
                  )}
                </article>
              ))}
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
                  <MessageDetail botId={view.id} message={item.result} />
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
