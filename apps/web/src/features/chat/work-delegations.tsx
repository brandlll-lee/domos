import type { ChatView } from "@domos/agent/view";
import { Button } from "@domos/ui/controls";
import { InlineNotice } from "@domos/ui/message";
import { useState } from "react";
import { client } from "../../client.ts";
import { useBots } from "../bots/use-bots.ts";

const labels: Record<string, string> = {
  queued: "等待执行",
  running: "正在处理",
  completed: "已完成",
  failed: "执行失败",
  cancelled: "已取消",
};
export function WorkDelegations({
  items,
  activity,
}: {
  items: NonNullable<ChatView["delegations"]>;
  activity?: ChatView["activity"];
}) {
  const { items: bots } = useBots();
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  if (!items.length) return null;
  return (
    <section className="work-delegations" aria-label="协作任务">
      {items.map((item) => (
        <div className="panel-card work-delegation" key={item.id}>
          <InlineNotice>
            {bots.find((bot) => bot.id === item.sender)?.name} →{" "}
            {bots.find((bot) => bot.id === item.recipient)?.name} ·{" "}
            {activity?.find((active) => active.sessionId === item.session)
              ?.waiting ??
              labels[item.status] ??
              item.status}
          </InlineNotice>
          <p>{item.task}</p>
          {item.result && <p>{item.result}</p>}
          {item.error && <p role="alert">{item.error}</p>}
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
