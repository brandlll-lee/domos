import { type ChatMessage, messageText } from "@domos/agent/messages";
import { Button } from "@domos/ui/controls";
import { useWorkAction } from "../bots/details/use-bot-work.ts";
import "./takeover-card.css";

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
  const preview = message.content.find((part) => part.type === "image");
  const waiting = request.state === "waiting";
  return (
    <section className="takeover-card" aria-label="接管请求">
      <header>
        <strong>
          {request.service === "browser" ? "Browser" : "Computer"}
        </strong>
        <span className="takeover-badge" data-state={request.state}>
          {waiting
            ? "需要你操作"
            : request.state === "done"
              ? "已完成"
              : "已失效"}
        </span>
      </header>
      <p>{messageText(message)}</p>
      {preview?.type === "image" && (
        <img
          src={`data:${preview.mimeType};base64,${preview.data}`}
          alt="接管画面预览"
        />
      )}
      {waiting && (
        <div className="takeover-card-actions">
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
            接管
          </Button>
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
                          : reject(new Error("操作尚未确认。请检查接管画面。")),
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
        </div>
      )}
      {action.error && waiting && <p role="alert">{action.error}</p>}
    </section>
  );
}
