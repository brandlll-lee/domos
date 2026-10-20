import type { EngineApproval } from "@domos/agent/harness/types";
import { Button } from "@domos/ui/controls";
import { Checkbox, TextField } from "@domos/ui/field";
import { ChoicePicker } from "@domos/ui/picker";
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
  const [answers, setAnswers] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      (approval.questions ?? [])
        .filter((item) => item.value !== undefined)
        .map((item) => [item.id, [item.value ?? ""]]),
    ),
  );
  const action = useWorkAction();
  const answer = (allow: boolean, optionId?: string) =>
    action.run(["approval", approval.id, allow, text, answers, optionId], () =>
      client.engines.answer({
        botId,
        id: approval.id,
        allow,
        ...(text ? { text } : {}),
        answers,
        ...(optionId ? { optionId } : {}),
      }),
    );
  return (
    <section
      className="settings-card detail-stack native-approval"
      aria-label={approval.title}
    >
      <strong>{approval.title}</strong>
      <p className="approval-detail">{approval.detail}</p>
      {approval.questions?.map((question) => (
        <div className="detail-stack" key={question.id}>
          {question.multiple ? (
            <fieldset className="approval-choices">
              <legend>{question.title}</legend>
              {question.options?.map((option) => (
                <Checkbox
                  key={option.id}
                  label={option.label}
                  checked={answers[question.id]?.includes(option.id) ?? false}
                  disabled={action.busy}
                  onCheckedChange={(checked) =>
                    setAnswers((current) => ({
                      ...current,
                      [question.id]: checked
                        ? [...(current[question.id] ?? []), option.id]
                        : (current[question.id] ?? []).filter(
                            (id) => id !== option.id,
                          ),
                    }))
                  }
                />
              ))}
            </fieldset>
          ) : question.options?.length ? (
            <ChoicePicker
              label={question.title}
              value={answers[question.id]?.[0] ?? ""}
              items={[
                { value: "", label: "请选择" },
                ...question.options.map((option) => ({
                  value: option.id,
                  label: option.label,
                })),
              ]}
              disabled={action.busy}
              onValueChange={(value) =>
                setAnswers((current) => ({
                  ...current,
                  [question.id]: value ? [value] : [],
                }))
              }
            />
          ) : (
            <TextField
              label={question.title}
              multiline={question.multiline}
              value={answers[question.id]?.[0] ?? ""}
              disabled={action.busy}
              onValueChange={(value) =>
                setAnswers((current) => ({
                  ...current,
                  [question.id]: [value],
                }))
              }
            />
          )}
          {question.options?.map(
            (option) =>
              option.description && (
                <p className="detail-note" key={option.id}>
                  {option.label}：{option.description}
                </p>
              ),
          )}
          {question.allowOther && !!question.options?.length && (
            <TextField
              label={`${question.title}：其他回答`}
              value={(answers[question.id] ?? [])
                .filter(
                  (value) =>
                    !question.options?.some((option) => option.id === value),
                )
                .join(", ")}
              disabled={action.busy}
              onValueChange={(value) =>
                setAnswers((current) => ({
                  ...current,
                  [question.id]: [
                    ...(current[question.id] ?? []).filter((value) =>
                      question.options?.some((option) => option.id === value),
                    ),
                    ...(value ? [value] : []),
                  ],
                }))
              }
            />
          )}
        </div>
      ))}
      {approval.kind === "question" && !approval.questions?.length && (
        <TextField
          label="你的回答"
          value={text}
          onValueChange={setText}
          disabled={action.busy}
        />
      )}
      <div className="form-actions">
        {approval.options?.map((option) => (
          <Button
            key={option.id}
            size="small"
            disabled={action.busy}
            onClick={() => void answer(true, option.id)}
          >
            {option.label}
          </Button>
        ))}
        {!approval.options?.length && (
          <Button
            size="small"
            disabled={
              action.busy ||
              Boolean(
                approval.questions?.some(
                  (question) =>
                    !answers[question.id]?.some((value) => value.trim()),
                ),
              )
            }
            onClick={() => void answer(true)}
          >
            {approval.kind === "question" ? "发送回答" : "允许这次操作"}
          </Button>
        )}
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
