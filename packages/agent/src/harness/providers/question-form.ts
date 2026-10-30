import { z } from "zod";
import type { EngineAnswer, EngineApproval } from "../types.ts";

type Schema = z.core.JSONSchema.JSONSchema;
export function formQuestions(schema: Schema): EngineApproval["questions"] {
  return Object.entries(schema.properties ?? {}).map(([id, field]) => {
    if (typeof field === "boolean")
      throw new Error("引擎返回了不支持的表单字段。");
    const choices = field.type === "array" ? field.items : field;
    if (!choices || typeof choices === "boolean" || Array.isArray(choices))
      throw new Error("引擎返回了不支持的表单字段。");
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
      throw new Error("引擎返回了不支持的表单字段。");
    return {
      id,
      title: field.title ?? field.description ?? id,
      required: schema.required?.includes(id) ?? false,
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
  });
}
export function formContent(schema: Schema, answer: EngineAnswer) {
  const values = Object.fromEntries(
    Object.entries(schema.properties ?? {}).flatMap(([id, field]) => {
      if (typeof field === "boolean")
        throw new Error("引擎返回了不支持的表单字段。");
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
    }),
  );
  const parsed = z.fromJSONSchema(schema).safeParse(values);
  if (!parsed.success) throw new Error("请按表单要求填写，再提交回答。");
  return parsed.data as Record<string, string | number | boolean | string[]>;
}
