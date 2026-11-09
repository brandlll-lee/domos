import type { ChatMessage } from "@domos/agent/messages";
import { Button } from "@domos/ui/controls";
import { Disclosure } from "@domos/ui/disclosure";
import { MonitorIcon } from "@phosphor-icons/react/dist/csr/Monitor";
import { client } from "../../client.ts";
import { useWorkAction } from "../bots/details/use-bot-work.ts";
import { MessageContent } from "./message-content.tsx";
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
  const title = request.service === "browser" ? "完成网页验证" : "接管电脑";
  const status = controlling
    ? "控制中"
    : waiting
      ? "需要操作"
      : request.state === "done"
        ? "已归还"
        : request.state === "cancelled"
          ? "已取消"
          : "已失效";
  const open = () =>
    window.dispatchEvent(
      new CustomEvent("domos:takeover-open", {
        detail: { botId, ...request },
      }),
    );
  const answer = (allow: boolean) =>
    action.run(request.id, async () => {
      if (!controlling) {
        await client.engines.answer({ botId, id: request.id, allow });
        return;
      }
      await new Promise<void>((resolve, reject) => {
        const detail = {
          botId,
          id: request.id,
          allow,
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
      });
    });
  const heading = (
    <>
      <strong>{title}</strong>
      <span className="takeover-badge" data-state={request.state}>
        {status}
      </span>
    </>
  );
  const body = (
    <MessageDetail botId={botId} message={message}>
      {(detail) => {
        const images = detail.content.filter((part) => part.type === "image");
        const preview = (
          <>
            <span className="takeover-preview-bar">
              <span>
                <MonitorIcon aria-hidden />
                画面预览
              </span>
              {request.url && (
                <span title={request.url}>{new URL(request.url).hostname}</span>
              )}
            </span>
            <MessageContent content={images} />
          </>
        );
        return (
          <div className="takeover-content">
            <MessageContent
              content={detail.content.filter((part) => part.type !== "image")}
            />
            {images.length > 0 &&
              (waiting ? (
                <button
                  type="button"
                  className="takeover-preview"
                  aria-label={
                    request.service === "browser"
                      ? "打开浏览器接管画面"
                      : "打开电脑接管画面"
                  }
                  disabled={action.busy}
                  onClick={open}
                >
                  {preview}
                </button>
              ) : (
                <div className="takeover-preview">{preview}</div>
              ))}
            {!waiting && request.url && (
              <a href={request.url} target="_blank" rel="noopener noreferrer">
                {request.url}
              </a>
            )}
          </div>
        );
      }}
    </MessageDetail>
  );
  return (
    <section className="takeover-card" aria-label="接管请求">
      {waiting ? (
        <>
          <header>{heading}</header>
          {body}
          <div className="takeover-actions">
            {controlling ? (
              <Button
                size="small"
                pending={action.busy}
                onClick={() => void answer(true)}
              >
                完成并继续
              </Button>
            ) : (
              <Button size="small" disabled={action.busy} onClick={open}>
                接管
              </Button>
            )}
            <Button
              size="small"
              variant="secondary"
              disabled={action.busy}
              onClick={() => void answer(false)}
            >
              取消
            </Button>
          </div>
          {action.error && <p role="alert">{action.error}</p>}
        </>
      ) : (
        <Disclosure label={heading}>{body}</Disclosure>
      )}
    </section>
  );
}
