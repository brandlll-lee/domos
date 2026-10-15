export class WorkError extends Error {
  readonly code: "NOT_FOUND" | "CONFLICT" | "BAD_REQUEST";
  constructor(code: "NOT_FOUND" | "CONFLICT" | "BAD_REQUEST", message: string) {
    super(message);
    this.code = code;
  }
}

export function requireRevision(actual: number, expected: number) {
  if (actual !== expected)
    throw new WorkError("CONFLICT", "内容已更新，请刷新后重试。");
}

export function requiredText(value: string, maximum: number) {
  const text = value.trim();
  if (!text || text.length > maximum)
    throw new WorkError("BAD_REQUEST", `内容长度须为1至${maximum}个字符。`);
  return text;
}

export function toolResult(value: unknown) {
  return { output: [{ type: "text" as const, text: JSON.stringify(value) }] };
}
