import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import spawn from "cross-spawn";
import { parse } from "jsonc-parser";
import { z } from "zod";

export function nativeMcpFiles(provider, env, cwd) {
  const user = env.HOME || env.USERPROFILE || homedir();
  if (provider === "cursor")
    return [
      join(user, ".cursor", "mcp.json"),
      join(cwd, ".cursor", "mcp.json"),
    ];
  if (provider === "antigravity")
    return [
      join(user, ".gemini", "config", "mcp_config.json"),
      join(cwd, ".agents", "mcp_config.json"),
    ];
  if (provider === "devin")
    return [
      join(
        env.APPDATA || env.XDG_CONFIG_HOME || join(user, ".config"),
        "devin",
        "config.json",
      ),
      join(
        env.APPDATA || env.XDG_CONFIG_HOME || join(user, ".config"),
        "devin",
        "mcp_config.json",
      ),
      join(cwd, ".devin", "config.json"),
      join(cwd, ".devin", "mcp_config.json"),
      join(cwd, ".devin", "config.local.json"),
      join(cwd, ".devin", "mcp_config.local.json"),
    ];
  throw new Error("此引擎未提供原生 MCP 配置读取。");
}

export function antigravityMcpCatalog(output) {
  const lines = output.trim().split(/\r?\n/);
  if (!/^NAME\s+TYPE\s+STATUS\s+COMMAND\/URL$/.test(lines[0] ?? ""))
    throw new Error("Antigravity 未返回可识别的 MCP 目录。");
  return lines
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const row = line.match(/^(\S+)\s+(stdio|http)\s+(enabled|disabled)\s+/);
      if (!row) throw new Error("Antigravity MCP 目录包含未知记录。");
      return {
        name: row[1],
        source: "Antigravity CLI",
        enabled: row[3] === "enabled",
        status: "unknown",
      };
    });
}

export async function nativeMcpCatalog(provider, env, cwd, signal, command) {
  if (provider === "antigravity") {
    const child = spawn(command, ["mcp", "list"], {
      env,
      cwd,
      windowsHide: true,
      signal,
      timeout: 30000,
    });
    let output = "";
    let overflow = false;
    child.stdout.on("data", (data) => {
      if (overflow) return;
      output += data.toString();
      if (Buffer.byteLength(output) > 1024 * 1024) {
        overflow = true;
        child.kill();
      }
    });
    child.stderr.resume();
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0 && !overflow
          ? resolve()
          : reject(new Error("Antigravity 原生 MCP 目录读取失败。")),
      );
    });
    return {
      items: antigravityMcpCatalog(output),
      errors: [],
      scope: "configuration",
      status: "complete",
      observedAt: Date.now(),
    };
  }
  const items = new Map();
  const errors = [];
  const schema = z.object({
    mcpServers: z
      .record(z.string(), z.object({ disabled: z.boolean().optional() }))
      .optional(),
  });
  for (const path of nativeMcpFiles(provider, env, cwd)) {
    signal?.throwIfAborted();
    try {
      if ((await stat(path)).size > 1024 * 1024)
        throw new Error("配置文件超过 1 MiB。");
      const syntax = [];
      const value = parse(
        await readFile(path, { encoding: "utf8", signal }),
        syntax,
        { allowTrailingComma: true },
      );
      if (syntax.length) throw new Error("原生 MCP 配置格式无效。");
      const config = schema.parse(value);
      for (const [name, server] of Object.entries(config.mcpServers ?? {}))
        if (name !== "domos")
          items.set(name, {
            name,
            source: path,
            enabled: server.disabled === true ? false : null,
            status: "unknown",
          });
    } catch (error) {
      signal?.throwIfAborted();
      if (error.code === "ENOENT") continue;
      errors.push({
        message: `原生 MCP 配置读取失败：${path}`,
        code: error.code,
      });
    }
  }
  return {
    items: [...items.values()],
    errors,
    scope: "configuration",
    status: errors.length ? "partial" : "complete",
    observedAt: Date.now(),
  };
}
