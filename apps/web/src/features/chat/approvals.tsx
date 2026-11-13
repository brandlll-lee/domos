import type { EngineAnswer } from "@domos/agent/harness/types";
import type { ChatMessage } from "@domos/agent/messages";
import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { Disclosure } from "@domos/ui/disclosure";
import { InlineNotice } from "@domos/ui/message";
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { useState } from "react";
import { client } from "../../client.ts";
import { useWorkAction } from "../bots/details/use-bot-work.ts";
import { CredentialCard, DraftCard } from "./interaction-card.tsx";
import { QuestionCard } from "./question-card.tsx";

export function Approval({
  botId,
  message,
}: {
  botId: number;
  message: ChatMessage;
}) {
  const record = message.approval;
  if (record?.request.credential)
    return (
      <CredentialCard
        botId={botId}
        record={record}
        credential={record.request.credential}
      />
    );
  if (record?.request.draft)
    return (
      <DraftCard botId={botId} record={record} draft={record.request.draft} />
    );
  if (record?.request.kind === "question")
    return <QuestionCard botId={botId} record={record} />;
  return <NativeApproval botId={botId} message={message} />;
}

function NativeApproval({
  botId,
  message,
}: {
  botId: number;
  message: ChatMessage;
}) {
  const record = message.approval;
  const request = record?.request;
  const [open, setOpen] = useState(false);
  const action = useWorkAction();
  if (!record || !request) return null;
  const pending = record.state === "pending";
  const respond = (answer: EngineAnswer) =>
    action.run([request.id, answer], () =>
      client.engines.answer({ botId, id: request.id, ...answer }),
    );
  const summary = [
    record.answer?.text,
    request.options?.find((option) => option.id === record.answer?.optionId)
      ?.label,
  ]
    .filter(Boolean)
    .join(" · ");
  const status =
    record.state === "expired"
      ? "已失效"
      : record.state === "denied"
        ? "已拒绝"
        : "已批准";
  const body = (
    <div className="interaction-card" data-state={record.state}>
      {pending && (
        <header className="interaction-heading">
          <ShieldCheckIcon aria-hidden />
          <strong>{request.title}</strong>
        </header>
      )}
      {request.fields?.length ? (
        <dl className="approval-fields">
          {request.fields.map((field) => (
            <div key={field.label}>
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {request.detail &&
        (pending || request.fields?.length ? (
          <p className="approval-detail">{request.detail}</p>
        ) : (
          <Disclosure className="approval-technical" label="技术详情">
            <p>{request.detail}</p>
          </Disclosure>
        ))}
      {request.url && (
        <a href={request.url} target="_blank" rel="noopener noreferrer">
          打开确认页面
        </a>
      )}
      {pending ? (
        <div className="interaction-actions">
          <Button
            size="small"
            variant="secondary"
            disabled={action.busy}
            onClick={() => void respond({ allow: false })}
          >
            拒绝
          </Button>
          {request.options?.map((option) => (
            <Button
              key={option.id}
              size="small"
              variant="secondary"
              disabled={action.busy}
              onClick={() => void respond({ allow: true, optionId: option.id })}
            >
              {option.label}
            </Button>
          ))}
          {!request.options?.length && (
            <Button
              size="small"
              pending={action.busy}
              onClick={() => void respond({ allow: true })}
            >
              {request.confirmLabel ?? "批准"}
            </Button>
          )}
        </div>
      ) : summary ? (
        <p className="interaction-result">{summary}</p>
      ) : null}
      {pending && action.error && (
        <p className="alert" role="alert">
          {action.error}
        </p>
      )}
    </div>
  );
  return (
    <section
      aria-label={request.title}
      data-state={record.state}
      className={pending ? undefined : "approval-record"}
    >
      {pending ? (
        body
      ) : (
        <>
          <InlineNotice
            align="center"
            icon={<ShieldCheckIcon />}
            onClick={() => setOpen(true)}
          >
            {request.title} · <span role="status">{status}</span>
          </InlineNotice>
          <Dialog
            open={open}
            onOpenChange={setOpen}
            title={request.title}
            className="decision-dialog"
          >
            <p className="interaction-result" role="status">
              {status}
            </p>
            {body}
          </Dialog>
        </>
      )}
    </section>
  );
}
