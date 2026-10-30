import { z } from "zod";

const budget = 8000;

function textOnlyError(result) {
  if (result.isError !== true) return result;
  const content = result.content.filter((part) => part.type === "text");
  if (content.length === result.content.length) return result;
  return {
    ...result,
    content: [
      ...content,
      {
        type: "text",
        text: "The screenshots in this error were removed. Call get_window_state again before any pixel action.",
      },
    ],
  };
}
const queryInput = z.strictObject({
  result: z.string(),
  path: z.string().optional(),
  search: z.string().optional(),
  fields: z.array(z.string()).optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export const resultQueryTool = {
  name: "query_result",
  description:
    "Read a held tool result without calling the original tool again. Use its result handle, an optional dot-separated path, and search to find records by text. Select fields to keep the answer small. Page with offset and limit.",
  inputSchema: {
    type: "object",
    properties: {
      result: { type: "string" },
      path: { type: "string" },
      search: { type: "string" },
      fields: { type: "array", items: { type: "string" } },
      offset: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
    required: ["result"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
};

function bounded(value, remaining = { chars: budget }) {
  if (Array.isArray(value)) {
    const kept = [];
    for (const item of value) {
      const size = JSON.stringify(item).length + 1;
      if (size > remaining.chars) break;
      remaining.chars -= size;
      kept.push(item);
    }
    return kept;
  }
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        bounded(item, remaining),
      ]),
    );
  if (typeof value === "string" && value.length > remaining.chars)
    return "[Read this field with query_result]";
  remaining.chars -= JSON.stringify(value)?.length ?? 0;
  return value;
}

export function openToolResults() {
  const held = new Map();
  let sequence = 0;
  function project(raw) {
    const result = textOnlyError(raw);
    const text = result.content.filter((part) => part.type === "text");
    const structured = result.structuredContent;
    const source = structured ?? text.map((part) => part.text).join("\n");
    const handle = `r${++sequence}`;
    held.set(handle, source);
    if (held.size > 20) held.delete(held.keys().next().value);
    const content = [];
    let trimmed = false;
    for (const part of result.content) {
      if (part.type !== "text" || part.text.length <= budget)
        content.push(part);
      else {
        let value;
        try {
          value = JSON.parse(part.text);
        } catch {}
        content.push({
          ...part,
          text: value
            ? JSON.stringify(bounded(value))
            : part.text.slice(0, budget).replace(/[\uD800-\uDBFF]$/u, ""),
        });
        trimmed = true;
      }
    }
    if (structured !== undefined) {
      const json = JSON.stringify(structured, function (key, value) {
        if (
          typeof value === "string" &&
          value.length >= 256 &&
          text.some((part) => part.text.includes(value))
        )
          return "[see result text]";
        if (key === "elements" && this.snapshot_id && Array.isArray(value))
          return undefined;
        return value;
      });
      if (!text.some((part) => part.text === json)) {
        const value = JSON.parse(json);
        content.push({
          type: "text",
          text: json.length > budget ? JSON.stringify(bounded(value)) : json,
        });
        trimmed ||= json.length > budget;
      }
    }
    if (trimmed)
      content.push({
        type: "text",
        text: `Partial result. Full records are held as ${handle}. Use query_result with result:"${handle}" and path/search/fields to read the required records. Do not search files or repeat an action to recover this result.`,
      });
    return { ...result, content };
  }
  return {
    project,
    query(input) {
      const {
        result,
        path = "",
        search,
        fields,
        offset = 0,
        limit = 20,
      } = queryInput.parse(input);
      if (!held.has(result))
        throw new Error("结果已失效。请读取原始工作记录。");
      let value = held.get(result);
      for (const key of path.split(".").filter(Boolean)) {
        if (!value || typeof value !== "object" || !Object.hasOwn(value, key))
          throw new Error("结果路径不存在。");
        value = value[key];
      }
      if (Array.isArray(value)) {
        const matches = search
          ? value.filter((item) =>
              JSON.stringify(item)
                .toLocaleLowerCase()
                .includes(search.toLocaleLowerCase()),
            )
          : value;
        const items = matches
          .slice(offset, offset + limit)
          .map((item) =>
            fields && item && typeof item === "object"
              ? Object.fromEntries(
                  fields
                    .filter((key) => Object.hasOwn(item, key))
                    .map((key) => [key, item[key]]),
                )
              : item,
          );
        value = { total: matches.length, offset, items };
      } else if (typeof value === "string")
        value = value.slice(offset, offset + budget);
      return project({ content: [], structuredContent: { value } });
    },
  };
}
