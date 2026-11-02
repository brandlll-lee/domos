import { stripVTControlCharacters } from "node:util";
import spawn from "cross-spawn";
import { accountEnvironment, resolveProgram } from "./account-environment.mjs";

export async function nativeMcp(config, home, source, cwd) {
  if (!["claude", "codex", "pi", "opencode"].includes(config.provider))
    throw new Error("此 ACP 程序未提供原生 MCP 目录接口。");
  const { env } = await accountEnvironment({}, home, source);
  const command = await resolveProgram(
    config.command ??
      { claude: "claude", codex: "codex", pi: "pi", opencode: "opencode" }[
        config.provider
      ],
    env,
  );
  if (!command) throw new Error("工作电脑未安装所选 Harness。");
  const json = config.provider === "codex" || config.provider === "pi";
  const args = ["mcp", "list", ...(json ? ["--json"] : [])];
  const output = await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let data = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("原生 MCP 目录读取超时。"));
    }, 30000);
    child.stdout.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        child.kill();
        reject(new Error("原生 MCP 目录过大。"));
      }
    });
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("原生 MCP 目录不可用。"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (!data.trim() && code) reject(new Error("原生 MCP 目录读取失败。"));
      else resolve(data);
    });
  });
  let items;
  if (json) {
    let parsed;
    try {
      parsed = JSON.parse(output);
    } catch {
      throw new Error("原生 MCP 目录不是有效的 JSON。");
    }
    items = (Array.isArray(parsed) ? parsed : (parsed.servers ?? [])).map(
      (item) => ({
        name: item.name,
        source: item.source ?? `${config.provider} 用户/项目配置`,
        enabled: item.enabled !== false,
        status: item.state ?? "unknown",
      }),
    );
  } else {
    const text = stripVTControlCharacters(output);
    items = text.split(/\r?\n/).flatMap((line) => {
      const match =
        config.provider === "claude"
          ? line.match(/^([\w.-]+):\s/)
          : line.match(
              /[●○]\s+([\w.-]+)\s+(connected|disabled|failed|needs_auth)/,
            );
      return match
        ? [
            {
              name: match[1],
              source: `${config.provider} 用户/项目配置`,
              enabled: match[2] !== "disabled",
              status: match[2] ?? "unknown",
            },
          ]
        : [];
    });
  }
  return {
    items: items.filter((item) => item.name !== "domos"),
    inheritance: config.provider === "claude" ? "selectable" : "native",
    readonly: true,
  };
}
