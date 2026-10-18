import type { EngineApproval } from "@domos/agent/harness/types";
import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { useState } from "react";
import { client } from "../../client.ts";
import { useWorkAction } from "../bots/details/use-bot-work.ts";

export function Approvals({
  botId,
  approvals,
}: {
  botId: number;
  approvals: EngineApproval[];
}) {
  return (
    <div className="detail-stack" aria-live="polite">
      {approvals.length > 1 && (
        <span className="activity-caption">{approvals.length} 项需要确认</span>
      )}
      {approvals.slice(0, 1).map((approval) => (
        <Approval key={approval.id} botId={botId} approval={approval} />
      ))}
    </div>
  );
}
function Approval({
  botId,
  approval,
}: {
  botId: number;
  approval: EngineApproval;
}) {
  const [text, setText] = useState("");
  const action = useWorkAction();
  const answer = (allow: boolean) =>
    action.run(["approval", approval.id, allow, text], () =>
      client.engines.answer({
        botId,
        id: approval.id,
        allow,
        ...(text ? { text } : {}),
      }),
    );
  return (
    <section
      className="settings-card detail-stack native-approval"
      aria-label={approval.title}
    >
      <strong>{approval.title}</strong>
      <p className="approval-detail">{approval.detail}</p>
      {approval.kind === "question" && (
        <TextField
          label="你的回答"
          value={text}
          onValueChange={setText}
          disabled={action.busy}
        />
      )}
      <div className="form-actions">
        <Button
          size="small"
          disabled={action.busy}
          onClick={() => void answer(true)}
        >
          {approval.kind === "question" ? "发送回答" : "允许这次操作"}
        </Button>
        <Button
          size="small"
          variant="secondary"
          disabled={action.busy}
          onClick={() => void answer(false)}
        >
          拒绝
        </Button>
      </div>
      {action.error && (
        <p className="alert" role="alert">
          {action.error}
        </p>
      )}
    </section>
  );
}
