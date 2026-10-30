import jmespath from "jmespath";
import { z } from "zod";

const budget = 8000;

const queryInput = z.strictObject({
  result: z.string(),
  query: z.string().trim().min(1),
});

export const resultQueryTool = {
  name: "query_result",
  description:
    "Query a held result with JMESPath over the complete value. Use the supplied shape and example. Filter nested arrays and select fields, e.g. apps[?contains(name, 'Music')].{name:name, path:launch_path}. Bound large answers with [0:20]. Read-only; never calls the original tool.",
  inputSchema: {
    type: "object",
    properties: {
      result: { type: "string" },
      query: { type: "string" },
    },
    required: ["result", "query"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
};

function queryGuide(value) {
  const fields = (item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.keys(item).slice(0, 12)
      : [];
  const arrays = Array.isArray(value)
    ? [["", value]]
    : Object.entries(value ?? {}).filter(([, item]) => Array.isArray(item));
  const shape = arrays.length
    ? arrays
        .map(
          ([key, items]) =>
            `${key || "@"}: ${items.length} items; fields: ${fields(items.find((item) => item != null)).join(", ")}`,
        )
        .join("; ")
    : `type: ${value === null ? "null" : typeof value}; keys: ${fields(value).join(", ")}`;
  const [key, items] = arrays[0] ?? [];
  const keys = items
    ? fields(items.find((item) => item != null)).slice(0, 2)
    : [];
  const example = items
    ? `${key ? JSON.stringify(key) : ""}[0:20]${keys.length ? `.{${keys.map((field) => `${JSON.stringify(field)}:${JSON.stringify(field)}`).join(",")}}` : ""}`
    : "@";
  return `Shape: ${shape}. Example: ${example}`;
}

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
  function project(result) {
    const text = result.content.filter((part) => part.type === "text");
    const structured = result.structuredContent;
    let source = structured ?? text.map((part) => part.text).join("\n");
    if (typeof source === "string") {
      try {
        source = JSON.parse(source);
      } catch {}
    }
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
        text: `Partial result. Full records are held as ${handle}. ${queryGuide(source)}. Use query_result {"result":"${handle}","query":"<JMESPath>"}. Select only required records and fields. Do not search files or repeat an action to recover this result.`,
      });
    return { ...result, content };
  }
  return {
    project,
    query(input) {
      const { result, query } = queryInput.parse(input);
      if (!held.has(result))
        throw new Error("结果已失效。请读取原始工作记录。");
      const source = held.get(result);
      let value;
      try {
        value = jmespath.search(source, query);
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Invalid JMESPath: ${error.message}. ${queryGuide(source)}`,
            },
          ],
        };
      }
      return project({
        content: [{ type: "text", text: JSON.stringify(value) ?? "null" }],
      });
    },
  };
}
