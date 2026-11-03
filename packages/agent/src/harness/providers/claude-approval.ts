import type { EngineAnswer, EngineApproval } from "../types.ts";

type ClaudeQuestion = {
  question: string;
  multiSelect?: boolean;
  options?: { label: string; description?: string }[];
};
function questions(args: Record<string, unknown>) {
  return args.tool_name === "AskUserQuestion"
    ? (args.input as { questions?: ClaudeQuestion[] })?.questions
    : undefined;
}
export function claudeApproval(
  id: string,
  args: Record<string, unknown>,
): EngineApproval {
  const items = questions(args);
  return {
    id,
    title: items ? "需要你的回答" : "允许这次操作？",
    detail: "",
    ...(!items
      ? {
          fields: [
            { label: "工具", value: String(args.tool_name) },
            ...Object.entries(
              (args.input as Record<string, unknown>) ?? {},
            ).map(([label, value]) => ({
              label,
              value:
                typeof value === "string"
                  ? value
                  : (JSON.stringify(value) ?? ""),
            })),
          ],
        }
      : {}),
    kind: items ? "question" : "permission",
    automatic:
      typeof args.tool_name === "string" &&
      args.tool_name.length > 0 &&
      !["AskUserQuestion", "ExitPlanMode", "EnterPlanMode"].includes(
        args.tool_name,
      ),
    ...(items
      ? {
          questions: items.map((item) => ({
            id: item.question,
            title: item.question,
            multiple: item.multiSelect ?? false,
            allowOther: true,
            options: item.options?.map((option) => ({
              id: option.label,
              ...option,
            })),
          })),
        }
      : {}),
  };
}
export function claudePermission(
  args: Record<string, unknown>,
  answer: EngineAnswer,
) {
  if (!answer.allow)
    return { behavior: "deny", message: "用户未授权这次操作。" };
  const items = questions(args);
  return {
    behavior: "allow",
    updatedInput: {
      ...((args.input as Record<string, unknown>) ?? {}),
      ...(items
        ? {
            answers: Object.fromEntries(
              items.map((item) => [
                item.question,
                answer.answers?.[item.question]?.join(", ") ??
                  answer.text ??
                  "",
              ]),
            ),
          }
        : {}),
    },
  };
}
