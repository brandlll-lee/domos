import { parseDocument } from "yaml";
import {
  SKILL_DESCRIPTION_LENGTH,
  SKILL_FILE_BYTES,
  SKILL_NAME_LENGTH,
} from "./limits.ts";
import { WorkError } from "./state.ts";

export function parseSkill(content: string) {
  if (Buffer.byteLength(content) > SKILL_FILE_BYTES)
    throw new WorkError("BAD_REQUEST", "SKILL.md超过256 KiB。");
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(
    content,
  );
  if (!match) throw new WorkError("BAD_REQUEST", "SKILL.md需要YAML前置信息。");
  const doc = parseDocument(match[1] ?? "", {
    schema: "failsafe",
    uniqueKeys: true,
  });
  if (doc.errors.length || doc.warnings.length)
    throw new WorkError("BAD_REQUEST", "技能YAML格式无效。");
  let fields: unknown;
  try {
    fields = doc.toJS({ maxAliasCount: 0 });
  } catch {
    throw new WorkError("BAD_REQUEST", "技能YAML格式无效。");
  }
  if (!fields || typeof fields !== "object" || Array.isArray(fields))
    throw new WorkError("BAD_REQUEST", "技能前置信息必须是对象。");
  const { name, description } = fields as Record<string, unknown>;
  if (
    typeof name !== "string" ||
    name.length > SKILL_NAME_LENGTH ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
  )
    throw new WorkError(
      "BAD_REQUEST",
      "技能名须为1至64位小写字母、数字或单连字符。",
    );
  if (
    typeof description !== "string" ||
    !description.trim() ||
    description.length > SKILL_DESCRIPTION_LENGTH
  )
    throw new WorkError("BAD_REQUEST", "技能描述须为1至1024个字符。");
  if (!match[2]?.trim())
    throw new WorkError("BAD_REQUEST", "技能正文不能为空。");
  return { name, description: description.trim(), body: match[2] };
}
