import type { EngineAnswer, EngineApproval } from "./types.ts";

export function questionChoices(
  question: NonNullable<EngineApproval["questions"]>[number],
) {
  return (question.options ?? []).flatMap((option) =>
    option.actions?.length
      ? option.actions.map((action) => ({
          id: action.id,
          label: `${option.label} · ${action.label}`,
        }))
      : [{ id: option.id, label: option.label }],
  );
}

export function validateQuestionAnswer(
  request: EngineApproval,
  answer: EngineAnswer,
) {
  if (
    !answer.allow ||
    request.kind !== "question" ||
    request.draft ||
    request.credential
  )
    return;
  if (!request.questions?.length) {
    if (
      request.options?.length
        ? !request.options.some((option) => option.id === answer.optionId)
        : !answer.text?.trim() || answer.text.length > 16000
    )
      throw new Error("请提供有效的回答。");
    return;
  }
  const answers = answer.answers ?? {};
  if (
    Object.keys(answers).some(
      (id) => !request.questions?.some((q) => q.id === id),
    )
  )
    throw new Error("回答包含未知问题。");
  for (const question of request.questions) {
    const values = answers[question.id] ?? [];
    const choices = questionChoices(question);
    if (
      (question.required !== false && !values.length) ||
      (!question.multiple && values.length > 1) ||
      new Set(values).size !== values.length ||
      values.some(
        (value) =>
          !value.trim() ||
          value.length > 16000 ||
          (choices.length &&
            !question.allowOther &&
            !choices.some((choice) => choice.id === value)),
      )
    )
      throw new Error("请提供有效的回答。");
  }
}
