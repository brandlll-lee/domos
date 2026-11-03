import type { EngineAnswer, EngineApproval } from "../types.ts";
import type { CodexFrame } from "./codex-wire.ts";
import { formContent, formQuestions } from "./question-form.ts";

export function codexApproval(frame: CodexFrame): EngineApproval {
  const params = frame.params ?? {};
  if (frame.method === "mcpServer/elicitation/request") {
    const approval: EngineApproval = {
      id: String(frame.id),
      title: "允许这次操作？",
      detail: [params.serverName, params.message].filter(Boolean).join("\n"),
      kind: "permission",
    };
    if (params.mode === "url") {
      const url = new URL(params.url ?? "");
      if (url.protocol !== "https:" || url.username || url.password)
        throw new Error("Codex 返回了不支持的确认链接。");
      return { ...approval, url: url.href };
    }
    if (params.mode !== "form" || params.requestedSchema?.type !== "object")
      throw new Error("Codex 返回了不支持的确认表单。");
    return {
      ...approval,
      automatic:
        params.requestedSchema.properties !== undefined &&
        Object.keys(params.requestedSchema.properties ?? {}).length === 0 &&
        params._meta?.codex_approval_kind === "mcp_tool_call" &&
        params._meta.persist?.includes("always") === true,
      kind: Object.keys(params.requestedSchema.properties ?? {}).length
        ? "question"
        : "permission",
      questions: formQuestions(params.requestedSchema),
    };
  }
  return {
    id: String(frame.id),
    title: params.questions ? "需要你的回答" : "允许这次操作？",
    detail: "",
    ...(!params.questions
      ? {
          fields: [
            ...Object.entries(params.permissions ?? {}).map(
              ([label, value]) => ({
                label,
                value:
                  typeof value === "string"
                    ? value
                    : (JSON.stringify(value) ?? ""),
              }),
            ),
            ...(params.command
              ? [{ label: "命令", value: params.command }]
              : []),
            ...(params.cwd ? [{ label: "工作目录", value: params.cwd }] : []),
            ...(params.reason ? [{ label: "原因", value: params.reason }] : []),
          ],
        }
      : {}),
    kind: params.questions ? "question" : "permission",
    automatic: [
      "item/commandExecution/requestApproval",
      "item/fileChange/requestApproval",
      "item/permissions/requestApproval",
    ].includes(frame.method),
    ...(params.questions
      ? {
          questions: params.questions.map((question) => ({
            id: question.id,
            title: question.question,
            allowOther: question.isOther,
            options: question.options?.map((option) => ({
              id: option.label,
              ...option,
            })),
          })),
        }
      : {}),
  };
}

export function codexAnswer(frame: CodexFrame, answer: EngineAnswer) {
  const params = frame.params ?? {};
  if (frame.method === "mcpServer/elicitation/request") {
    let content: unknown = null;
    if (answer.allow && params.mode === "form" && params.requestedSchema) {
      content = formContent(params.requestedSchema, answer);
    }
    return {
      action: answer.allow ? "accept" : "decline",
      content,
      _meta: null,
    };
  }
  if (frame.method === "item/tool/requestUserInput")
    return {
      answers: Object.fromEntries(
        (params.questions ?? []).map((question) => [
          question.id,
          {
            answers: answer.allow
              ? (answer.answers?.[question.id] ?? [answer.text ?? ""])
              : [],
          },
        ]),
      ),
    };
  if (frame.method === "item/permissions/requestApproval")
    return {
      permissions: answer.allow ? (params.permissions ?? {}) : {},
      scope: "turn",
    };
  return { decision: answer.allow ? "accept" : "decline" };
}
