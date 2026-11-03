import type { ChatMessage } from "@domos/agent/messages";
import { Button } from "@domos/ui/controls";
import { useWorkAction } from "../bots/details/use-bot-work.ts";
import { MessageDetail } from "./message-detail.tsx";

export function TakeoverCard({
  botId,
  message,
}: {
  botId: number;
  message: ChatMessage;
}) {
  const action = useWorkAction();
  const request = message.takeover;
  if (!request) return null;
  const controlling = request.state === "controlling";
  const waiting = request.state === "waiting" || controlling;
  return (
    <section className="interaction-card takeover-card" aria-label="接管请求">
      <header>
        <strong>{request.service === "browser" ? "浏览器" : "电脑"}</strong>
        <span className="takeover-badge" data-state={request.state}>
          {controlling
            ? "控制中"
            : waiting
              ? "等待接管"
              : request.state === "done"
                ? "已归还"
                : "已失效"}
        </span>
      </header>
      <MessageDetail botId={botId} message={message} />
      {request.url && (
        <p className="takeover-url" title={request.url}>
          请求页面：{request.url}
        </p>
      )}
      {waiting && (
        <div className="interaction-actions">
          <Button
            size="small"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("domos:takeover-open", {
                  detail: { botId, ...request },
                }),
              )
            }
          >
            {controlling ? "查看画面" : "接管"}
          </Button>
          {controlling && (
            <Button
              size="small"
              variant="secondary"
              pending={action.busy}
              onClick={() =>
                void action.run(
                  request.id,
                  () =>
                    new Promise<void>((resolve, reject) => {
                      const detail = {
                        botId,
                        id: request.id,
                        handled: false,
                        finish: (ok: boolean) =>
                          ok
                            ? resolve()
                            : reject(
                                new Error("操作尚未确认。请检查接管画面。"),
                              ),
                      };
                      window.dispatchEvent(
                        new CustomEvent("domos:takeover-complete", { detail }),
                      );
                      if (!detail.handled)
                        reject(new Error("请先点击接管，完成后再继续任务。"));
                    }),
                )
              }
            >
              我已完成
            </Button>
          )}
        </div>
      )}
      {action.error && waiting && <p role="alert">{action.error}</p>}
    </section>
  );
}
