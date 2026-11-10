import type { BotPresence } from "@domos/agent/bots";
import type { ChatView } from "@domos/agent/view";
import { Button } from "@domos/ui/controls";
import { InlineNotice } from "@domos/ui/message";
import { useState } from "react";
import { client } from "../../client.ts";

const labels: Record<string, string> = {
  queued: "等待执行",
  running: "正在处理",
  completed: "已完成",
  failed: "执行失败",
  cancelled: "已取消",
};
export function Delegations({
  items,
  bots,
}: {
  items: NonNullable<ChatView["delegations"]>;
  bots: BotPresence[];
}) {
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  if (!items.length) return null;
  return (
    <section className="delegations" aria-label="协作任务">
      {items.map((item) => (
        <div className="delegation-row" key={item.id}>
          <InlineNotice>
            {bots.find((bot) => bot.id === item.sender)?.name} →{" "}
            {bots.find((bot) => bot.id === item.recipient)?.name} ·{" "}
            {labels[item.status] ?? item.status}
          </InlineNotice>
          <span>{item.task}</span>
          {item.result && <span>{item.result}</span>}
          {item.error && <span role="alert">{item.error}</span>}
          <Button
            variant="ghost"
            size="small"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("domos:work-open", {
                  detail: { botId: item.session, turnId: undefined },
                }),
              )
            }
          >
            工作记录
          </Button>
          {["queued", "running"].includes(item.status) && (
            <Button
              variant="ghost"
              size="small"
              pending={pending === item.id}
              onClick={async () => {
                setPending(item.id);
                setError(undefined);
                try {
                  await client.teams.cancel({
                    sessionId: item.source,
                    id: item.id,
                  });
                } catch (cause) {
                  setError(
                    cause instanceof Error ? cause.message : "停止失败。",
                  );
                } finally {
                  setPending(undefined);
                }
              }}
            >
              停止
            </Button>
          )}
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
