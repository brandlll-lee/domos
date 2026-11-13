import { questionChoices } from "@domos/agent/harness/questions";
import type { EngineAnswer, EngineApproval } from "@domos/agent/harness/types";
import type { ChatMessage } from "@domos/agent/messages";
import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { TextField } from "@domos/ui/field";
import { ArrowUUpLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowUUpLeft";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { CircleIcon } from "@phosphor-icons/react/dist/csr/Circle";
import { type ReactNode, useState } from "react";
import { client } from "../../client.ts";
import { useWorkAction } from "../bots/details/use-bot-work.ts";
import { Attachments } from "./attachments.tsx";

function QuestionReply({
  children,
  selected,
  multiple,
  disabled,
  onClick,
}: {
  children: ReactNode;
  selected: boolean;
  multiple?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <ArrowUUpLeftIcon aria-hidden />
      <span className="question-reply-copy">{children}</span>
      {(multiple || (!onClick && selected)) &&
        (selected ? (
          <CheckCircleIcon
            aria-hidden={!!onClick}
            aria-label={onClick ? undefined : "已选择"}
          />
        ) : (
          <CircleIcon aria-hidden />
        ))}
    </>
  );
  return onClick ? (
    <Button
      variant="ghost"
      className="question-reply"
      disabled={disabled}
      aria-pressed={selected}
      onClick={onClick}
    >
      {content}
    </Button>
  ) : (
    <div className="question-reply" data-selected={selected || undefined}>
      {content}
    </div>
  );
}

export function QuestionCard({
  botId,
  record,
}: {
  botId: number;
  record: NonNullable<ChatMessage["approval"]>;
}) {
  const request = record.request;
  const pending = record.state === "pending";
  const questions: NonNullable<EngineApproval["questions"]> = request.questions
    ?.length
    ? request.questions
    : [
        {
          id: request.id,
          title: request.title,
          options: request.options,
        },
      ];
  const [answers, setAnswers] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      questions.map((question) => [
        question.id,
        Array.isArray(question.value)
          ? question.value
          : question.value
            ? [question.value]
            : [],
      ]),
    ),
  );
  const [custom, setCustom] = useState<Record<string, boolean>>({});
  const [visible, setVisible] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const action = useWorkAction();
  const disabled = !pending || action.busy || submitted;
  const selected = pending
    ? answers
    : (record.answer?.answers ?? {
        [request.id]: record.answer?.optionId ? [record.answer.optionId] : [],
      });
  const single = questions.length === 1 && !questions[0]?.multiple;
  const status =
    record.state === "expired"
      ? "已失效"
      : record.state === "denied"
        ? "已取消"
        : "已回答";
  function respond(answer: EngineAnswer) {
    void action.run(
      [request.id, answer],
      () =>
        client.engines.answer({
          botId,
          id: request.id,
          ...answer,
        }),
      () => setSubmitted(true),
    );
  }
  function choose(question: (typeof questions)[number], value: string) {
    const values = question.multiple
      ? (selected[question.id] ?? []).includes(value)
        ? (selected[question.id] ?? []).filter((id) => id !== value)
        : [...(selected[question.id] ?? []), value]
      : [value];
    const next = { ...answers, [question.id]: values };
    setAnswers(next);
    if (!question.multiple)
      setCustom((current) => ({ ...current, [question.id]: false }));
    if (single)
      respond(
        request.questions?.length
          ? { allow: true, answers: next }
          : { allow: true, optionId: value },
      );
  }
  const materials = (files: EngineApproval["attachments"]) =>
    files?.length ? (
      <div className="question-media">
        <Attachments botId={botId} files={files} />
      </div>
    ) : null;
  const body = (
    <div className="question-content">
      {materials(request.attachments)}
      <header className="question-heading">
        {pending ? (
          <strong>{request.title}</strong>
        ) : (
          <span className="question-footnote" role="status">
            {status}
          </span>
        )}
        {request.detail && <p>{request.detail}</p>}
      </header>
      {questions.map((question) => {
        const options = question.options ?? [];
        const cards = options.some(
          (option) => option.attachments?.length || option.actions?.length,
        );
        const count = visible[question.id] ?? (pending ? 4 : options.length);
        const choices = questionChoices(question);
        const values = selected[question.id] ?? [];
        return (
          <section
            className="question-field"
            key={question.id}
            aria-label={
              question.title !== request.title ? question.title : undefined
            }
          >
            {question.title !== request.title && (
              <strong>{question.title}</strong>
            )}
            {!!options.length && (
              <div
                className={cards ? "question-candidates" : "question-replies"}
              >
                {options.slice(0, count).map((option) => {
                  const actions = option.actions?.length
                    ? option.actions
                    : [
                        {
                          id: option.id,
                          label: cards ? "选择这一项" : option.label,
                        },
                      ];
                  return (
                    <div
                      className={
                        cards ? "question-candidate" : "question-choice"
                      }
                      key={option.id}
                    >
                      {materials(option.attachments)}
                      {cards && (
                        <div className="question-candidate-copy">
                          <strong>{option.label}</strong>
                          {option.description && <p>{option.description}</p>}
                        </div>
                      )}
                      <div className="question-choice-actions">
                        {actions.map((choice) => (
                          <QuestionReply
                            key={choice.id}
                            disabled={disabled}
                            selected={values.includes(choice.id)}
                            multiple={question.multiple}
                            onClick={
                              pending
                                ? () => choose(question, choice.id)
                                : undefined
                            }
                          >
                            {choice.label}
                            {!cards && option.description && (
                              <small>{option.description}</small>
                            )}
                          </QuestionReply>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {(options.length > count ||
              (pending &&
                question.allowOther &&
                !!options.length &&
                !custom[question.id])) && (
              <div className="question-utilities">
                {options.length > count && (
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() =>
                      setVisible((current) => ({
                        ...current,
                        [question.id]: count + 4,
                      }))
                    }
                  >
                    显示更多选项（{options.length - count}）
                  </Button>
                )}
                {pending &&
                  question.allowOther &&
                  !!options.length &&
                  !custom[question.id] && (
                    <Button
                      variant="ghost"
                      size="small"
                      disabled={disabled}
                      onClick={() => {
                        setCustom((current) => ({
                          ...current,
                          [question.id]: true,
                        }));
                        if (!question.multiple)
                          setAnswers((current) => ({
                            ...current,
                            [question.id]: [],
                          }));
                      }}
                    >
                      自己填写
                    </Button>
                  )}
              </div>
            )}
            {pending && (!options.length || custom[question.id]) && (
              <TextField
                label="你的回答"
                multiline={question.multiline}
                disabled={disabled}
                maxLength={16000}
                value={values
                  .filter(
                    (value) => !choices.some((choice) => choice.id === value),
                  )
                  .join(", ")}
                onValueChange={(value) =>
                  setAnswers((current) => ({
                    ...current,
                    [question.id]: [
                      ...(question.multiple
                        ? (current[question.id] ?? []).filter((id) =>
                            choices.some((choice) => choice.id === id),
                          )
                        : []),
                      ...(value ? [value] : []),
                    ],
                  }))
                }
              />
            )}
            {!pending &&
              (values.some(
                (value) => !choices.some((choice) => choice.id === value),
              ) ||
                record.answer?.text) && (
                <p className="question-written-answer">
                  {values
                    .filter(
                      (value) => !choices.some((choice) => choice.id === value),
                    )
                    .join("、") || record.answer?.text}
                </p>
              )}
          </section>
        );
      })}
      {request.footer && <p className="question-footnote">{request.footer}</p>}
      {pending && (
        <footer className="question-controls">
          <Button
            variant="ghost"
            size="small"
            disabled={disabled}
            onClick={() => respond({ allow: false })}
          >
            取消
          </Button>
          {(!single ||
            questions.some((q) => custom[q.id] || !q.options?.length)) && (
            <Button
              size="small"
              pending={action.busy}
              disabled={
                disabled ||
                questions.some(
                  (q) =>
                    q.required !== false &&
                    !answers[q.id]?.some((value) => value.trim()),
                )
              }
              onClick={() =>
                respond(
                  request.questions?.length
                    ? { allow: true, answers }
                    : { allow: true, text: answers[request.id]?.[0] ?? "" },
                )
              }
            >
              发送回答
            </Button>
          )}
        </footer>
      )}
      {pending && action.error && (
        <p className="alert" role="alert">
          {action.error}
        </p>
      )}
    </div>
  );
  return (
    <section
      className="question-card"
      aria-label={request.title}
      data-state={record.state}
      aria-busy={action.busy || undefined}
    >
      {pending ? (
        body
      ) : (
        <>
          <div className="question-summary">
            <strong>{request.title}</strong>
            <span className="question-footnote" role="status">
              {status}
            </span>
            {record.state === "answered" &&
              questions.map((question) => {
                const values = selected[question.id] ?? [];
                const choices = questionChoices(question);
                return (
                  <div className="question-answer" key={question.id}>
                    <p>
                      你选择了：
                      {values
                        .map(
                          (id) =>
                            choices.find((choice) => choice.id === id)?.label ??
                            id,
                        )
                        .join("、") ||
                        record.answer?.text ||
                        "已确认"}
                    </p>
                    {question.options
                      ?.filter(
                        (option) =>
                          values.includes(option.id) ||
                          option.actions?.some((action) =>
                            values.includes(action.id),
                          ),
                      )
                      .map((option) => (
                        <div key={option.id}>
                          {materials(option.attachments)}
                        </div>
                      ))}
                  </div>
                );
              })}
          </div>
          <Button
            variant="ghost"
            size="small"
            className="question-review"
            onClick={() => setOpen(true)}
          >
            查看完整问题
          </Button>
          <Dialog
            open={open}
            onOpenChange={setOpen}
            title={request.title}
            className="decision-dialog"
          >
            {body}
          </Dialog>
        </>
      )}
    </section>
  );
}
