import type { ChatMessage } from "@domos/agent/messages";
import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { MessageMarkdown } from "@domos/ui/markdown";
import { type ReactNode, useEffect, useState } from "react";
import { client } from "../../client.ts";
import { useWorkAction } from "../bots/details/use-bot-work.ts";
import { MessageBody } from "./message-body.tsx";

type Props = { botId: number; record: NonNullable<ChatMessage["approval"]> };

function Card({
  record,
  children,
  actions,
  error,
  busy,
}: Props & {
  children?: ReactNode;
  actions?: ReactNode;
  error?: string | null;
  busy?: boolean;
}) {
  const pending = record.state === "pending";
  return (
    <section
      className="interaction-card action-card"
      aria-label={record.request.title}
      aria-busy={busy || undefined}
      data-state={record.state}
    >
      <header className="interaction-heading">
        <strong>{record.request.title}</strong>
      </header>
      {record.request.detail && (
        <p className="approval-detail">{record.request.detail}</p>
      )}
      {children}
      {pending ? (
        <>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <footer className="interaction-actions">{actions}</footer>
        </>
      ) : (
        <p className="interaction-result" role="status">
          {record.state === "expired"
            ? "已失效"
            : record.state === "denied"
              ? "已取消"
              : record.request.credential
                ? "已配置"
                : "已确认"}
        </p>
      )}
    </section>
  );
}

export function DraftCard({
  botId,
  record,
  draft,
}: Props & { draft: NonNullable<Props["record"]["request"]["draft"]> }) {
  const pending = record.state === "pending";
  const action = useWorkAction();
  const [editing, setEditing] = useState(false);
  const [draftValues, setValues] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(
      (draft.fields ?? []).map((field) => [
        field.id,
        record.answer?.answers?.[field.id]?.[0] ?? field.value,
      ]),
    ),
    ...(draft.body !== undefined
      ? { body: record.answer?.answers?.body?.[0] ?? draft.body }
      : {}),
  }));
  const values = pending
    ? draftValues
    : {
        ...Object.fromEntries(
          (draft.fields ?? []).map((field) => [
            field.id,
            record.answer?.answers?.[field.id]?.[0] ?? field.value,
          ]),
        ),
        ...(draft.body !== undefined
          ? { body: record.answer?.answers?.body?.[0] ?? draft.body }
          : {}),
      };
  const editable =
    draft.editable || draft.fields?.some((field) => field.editable);
  const change = (id: string, value: string) =>
    setValues((current) => ({ ...current, [id]: value }));
  const respond = (allow: boolean) =>
    void action.run([record.request.id, allow, values], () =>
      client.engines.answer({
        botId,
        id: record.request.id,
        allow,
        ...(allow
          ? {
              answers: Object.fromEntries(
                Object.entries(values)
                  .filter(([id]) =>
                    id === "body"
                      ? draft.editable
                      : draft.fields?.some(
                          (field) => field.id === id && field.editable,
                        ),
                  )
                  .map(([id, value]) => [id, [value]]),
              ),
            }
          : {}),
      }),
    );
  return (
    <Card
      botId={botId}
      record={record}
      error={action.error}
      busy={action.busy}
      actions={
        <>
          {editable && (
            <Button
              size="small"
              variant="ghost"
              disabled={action.busy}
              onClick={() => setEditing(!editing)}
            >
              {editing ? "预览" : "修改"}
            </Button>
          )}
          <Button
            size="small"
            variant="secondary"
            disabled={action.busy}
            onClick={() => respond(false)}
          >
            取消
          </Button>
          {!editing && (
            <Button
              size="small"
              pending={action.busy}
              onClick={() => respond(true)}
            >
              {record.request.confirmLabel ?? "确认"}
            </Button>
          )}
        </>
      }
    >
      {!!draft.fields?.length && (
        <dl className="approval-fields draft-fields">
          {draft.fields.map((field) => (
            <div key={field.id}>
              {pending && editing && field.editable ? (
                <>
                  <dt className="sr-only">{field.label}</dt>
                  <dd>
                    <TextField
                      label={field.label}
                      value={values[field.id] ?? ""}
                      multiline={field.multiline}
                      maxLength={16000}
                      disabled={action.busy}
                      onValueChange={(value) => change(field.id, value)}
                    />
                  </dd>
                </>
              ) : (
                <>
                  <dt>{field.label}</dt>
                  <dd>{values[field.id]}</dd>
                </>
              )}
            </div>
          ))}
        </dl>
      )}
      {draft.body !== undefined &&
        (pending && editing && draft.editable ? (
          <TextField
            label="正文"
            multiline
            maxLength={16000}
            value={values.body ?? ""}
            disabled={action.busy}
            onValueChange={(value) => change("body", value)}
          />
        ) : (
          <div className="draft-preview">
            <MessageBody>
              <MessageMarkdown>{values.body ?? ""}</MessageMarkdown>
            </MessageBody>
          </div>
        ))}
    </Card>
  );
}

export function CredentialCard({
  botId,
  record,
  credential,
}: Props & {
  credential: NonNullable<Props["record"]["request"]["credential"]>;
}) {
  const pending = record.state === "pending";
  const [values, setValues] = useState<Record<string, string>>({});
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const action = useWorkAction();
  useEffect(() => {
    if (!pending) setValues({});
  }, [pending]);
  const submit = () =>
    void action.run(
      record.request.id,
      () =>
        client.engines.credentials({ botId, id: record.request.id, values }),
      () => setValues({}),
    );
  const authorize = () =>
    void action.run([record.request.id, "oauth"], async () => {
      const result = await client.mcp.login({ id: credential.connectionId });
      setLoginUrl(result.url);
      if (result.url) window.open(result.url, "_blank", "noopener,noreferrer");
      else
        await client.engines.credentials({
          botId,
          id: record.request.id,
          values: {},
        });
    });
  return (
    <Card
      botId={botId}
      record={record}
      error={action.error}
      busy={action.busy}
      actions={
        <>
          <Button
            size="small"
            variant="secondary"
            disabled={action.busy}
            onClick={() =>
              void action.run(
                [record.request.id, "cancel"],
                () =>
                  client.engines.answer({
                    botId,
                    id: record.request.id,
                    allow: false,
                  }),
                () => setValues({}),
              )
            }
          >
            取消
          </Button>
          {credential.mode === "oauth" && !loginUrl ? (
            <Button size="small" pending={action.busy} onClick={authorize}>
              连接
            </Button>
          ) : (
            <Button
              type="submit"
              form={`credential-${record.request.id}`}
              size="small"
              pending={action.busy}
              disabled={
                credential.mode === "secret" &&
                credential.fields.some((field) => !values[field.name]?.trim())
              }
            >
              {credential.mode === "oauth" ? "已完成授权，继续" : "保存并继续"}
            </Button>
          )}
        </>
      }
    >
      {pending && (
        <form
          id={`credential-${record.request.id}`}
          className="credential-fields"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {credential.mode === "secret"
            ? credential.fields.map((field) => (
                <TextField
                  key={field.name}
                  label={field.label}
                  type="password"
                  required
                  maxLength={32768}
                  autoComplete="off"
                  value={values[field.name] ?? ""}
                  disabled={action.busy}
                  onValueChange={(value) =>
                    setValues((current) => ({
                      ...current,
                      [field.name]: value,
                    }))
                  }
                />
              ))
            : loginUrl && (
                <a href={loginUrl} target="_blank" rel="noopener noreferrer">
                  打开授权页面
                </a>
              )}
          {credential.mode === "secret" && (
            <p className="interaction-result">
              凭证将加密保存，不进入聊天记录或模型上下文。
            </p>
          )}
        </form>
      )}
    </Card>
  );
}
