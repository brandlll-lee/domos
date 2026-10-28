import { createReadStream } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { createInterface } from "node:readline";

const frameBytes = 16 * 1024 * 1024;

export function historyProjection(value) {
  if (Array.isArray(value)) return value.map(historyProjection);
  if (!value || typeof value !== "object") return value;
  if (
    ["image", "image_url"].includes(value.type) ||
    (value.type === "file" && value.url?.startsWith("data:"))
  )
    return { type: "text", text: "[Image retained in native session]" };
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === "text" && typeof item === "string" && item.length > 32000
        ? `${item.slice(0, 32000)}\n[Excerpt; full content retained in native session]`
        : historyProjection(item),
    ]),
  );
}

async function piPath(sessionId, home) {
  const root = await realpath(join(home, "pi", "sessions"));
  const path = join(await realpath(dirname(sessionId)), basename(sessionId));
  const child = relative(root, path);
  if (!child || child.startsWith("..") || isAbsolute(child))
    throw new Error("原生会话路径不属于这台工作电脑的 Pi 会话目录。");
  try {
    if ((await lstat(path)).isSymbolicLink())
      throw new Error("Pi 会话文件必须位于工作电脑的会话目录中。");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return path;
}

export async function nativeCheckpoint(input, home) {
  if (input.provider === "opencode") return String(Date.now());
  if (input.provider !== "pi") throw new Error("不支持此引擎的书签。");
  const path = await piPath(input.sessionId, home);
  let file;
  try {
    file = await open(path, "r");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  try {
    const { size } = await file.stat();
    for (
      let length = Math.min(size, 65536);
      ;
      length = Math.min(size, length * 2)
    ) {
      if (length > frameBytes)
        throw new Error("Pi 书签读取失败：单条记录超过大小限制。");
      const bytes = Buffer.alloc(length);
      await file.read(bytes, 0, length, size - length);
      const lines = bytes.toString("utf8").trimEnd().split("\n");
      if (lines.length > 1 || length === size) {
        const last = JSON.parse(lines.at(-1) || "{}");
        return last.type === "session" ? null : (last.id ?? null);
      }
    }
  } finally {
    await file.close();
  }
}

export async function nativeHistory(input, home) {
  const selected = [];
  let found = !input.since;
  let bytes = 0;
  const add = (entry) => {
    const projected = historyProjection(entry);
    bytes += Buffer.byteLength(JSON.stringify(projected));
    if (selected.length >= 256 || bytes > frameBytes / 2)
      throw new Error("原生会话恢复范围过大。已有记录已保留，请检查执行结果。");
    selected.push(projected);
  };
  if (input.provider === "pi") {
    const source = createReadStream(await piPath(input.sessionId, home));
    const lines = createInterface({ input: source, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line.trim()) continue;
        if (Buffer.byteLength(line) > frameBytes)
          throw new Error("Pi 会话恢复失败：单条记录超过大小限制。");
        const entry = JSON.parse(line);
        if (entry.id === input.since) {
          found = true;
          selected.length = 0;
          bytes = 0;
        } else if (found && entry.type !== "session") add(entry);
      }
    } finally {
      lines.close();
      source.destroy();
    }
  } else if (input.provider === "claude") {
    const { getSessionMessages } = await import(
      "@anthropic-ai/claude-agent-sdk"
    );
    for (let offset = 0; ; offset += 64) {
      const page = await getSessionMessages(input.sessionId, {
        dir: process.cwd(),
        offset,
        limit: 64,
      });
      for (const entry of page) {
        if (entry.parent_tool_use_id) continue;
        if (entry.uuid === input.since) found = true;
        if (found) add(entry);
      }
      if (page.length < 64) break;
    }
  } else throw new Error("不支持此引擎的历史读取。");
  if (!found) throw new Error("原生会话中找不到恢复书签。请检查执行结果。");
  return selected;
}
