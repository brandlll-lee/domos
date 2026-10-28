import { z } from "zod";
import type { EngineAnswer, EngineApproval } from "../types.ts";
import type { CodexFrame } from "./codex-wire.ts";

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
      questions: Object.entries(params.requestedSchema.properties ?? {}).map(
        ([id, field]) => {
          if (typeof field === "boolean")
            throw new Error("Codex 返回了不支持的表单字段。");
          const choices = field.type === "array" ? field.items : field;
          if (
            !choices ||
            typeof choices === "boolean" ||
            Array.isArray(choices)
          )
            throw new Error("Codex 返回了不支持的表单字段。");
          const options =
            field.type === "boolean"
              ? [
                  { id: "true", label: "是" },
                  { id: "false", label: "否" },
                ]
              : (choices.oneOf?.map((item) => ({
                  id: String(item.const),
                  label: item.title ?? String(item.const),
                })) ??
                choices.anyOf?.map((item) => ({
                  id: String(item.const),
                  label: item.title ?? String(item.const),
                })) ??
                choices.enum?.map((value, index) => ({
                  id: String(value),
                  label:
                    (choices.enumNames as string[] | undefined)?.[index] ??
                    String(value),
                })));
          if (
            !["string", "number", "integer", "boolean", "array"].includes(
              String(field.type),
            ) ||
            (field.type === "array" && !options)
          )
            throw new Error("Codex 返回了不支持的表单字段。");
          return {
            id,
            title: field.title ?? field.description ?? id,
            required: params.requestedSchema?.required?.includes(id) ?? false,
            ...(options ? { options } : {}),
            ...(field.type === "array" ? { multiple: true } : {}),
            ...(field.default !== undefined
              ? {
                  value: Array.isArray(field.default)
                    ? field.default.map(String)
                    : String(field.default),
                }
              : {}),
          };
        },
      ),
    };
  }
  return {
    id: String(frame.id),
    title: params.questions ? "需要你的回答" : "允许这次操作？",
    detail: [
      params.command,
      params.cwd,
      params.reason,
      ...(params.questions?.map((q) => q.question) ?? []),
      params.permissions ? JSON.stringify(params.permissions) : "",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 8000),
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
      const values = Object.fromEntries(
        Object.entries(params.requestedSchema.properties ?? {}).flatMap(
          ([id, field]) => {
            if (typeof field === "boolean")
              throw new Error("Codex 返回了不支持的表单字段。");
            const input = answer.answers?.[id];
            if (!input?.length || (field.type !== "string" && input[0] === ""))
              return [];
            const value =
              field.type === "array"
                ? input
                : field.type === "number" || field.type === "integer"
                  ? Number(input[0])
                  : field.type === "boolean"
                    ? input[0] === "true"
                      ? true
                      : input[0] === "false"
                        ? false
                        : input[0]
                    : input[0];
            return [[id, value]];
          },
        ),
      );
      const parsed = z.fromJSONSchema(params.requestedSchema).safeParse(values);
      if (!parsed.success) throw new Error("请按表单要求填写，再提交回答。");
      content = parsed.data;
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
