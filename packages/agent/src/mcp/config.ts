import { z } from "zod";

const values = z.record(z.string().min(1).max(256), z.string().max(32768));
export const mcpConfig = z.discriminatedUnion("transport", [
  z.object({
    transport: z.literal("stdio"),
    command: z.string().min(1).max(4096),
    args: z.array(z.string().max(4096)).max(128).default([]),
    env: values.default({}),
  }),
  z.object({
    transport: z.literal("http"),
    url: z
      .url()
      .max(8192)
      .refine((value) => ["http:", "https:"].includes(new URL(value).protocol)),
    headers: values.default({}),
  }),
]);
export type McpConfig = z.infer<typeof mcpConfig>;

export function parseMcp(text: string): { name: string; config: McpConfig }[] {
  text = text.trim();
  if (/^https?:\/\//.test(text))
    return [
      {
        name: new URL(text).hostname,
        config: mcpConfig.parse({ transport: "http", url: text }),
      },
    ];
  if (text.startsWith("{")) {
    const parsed = JSON.parse(text);
    const entries = parsed.mcpServers
      ? Object.entries(parsed.mcpServers)
      : [[parsed.name ?? "mcp", parsed]];
    return entries.map(([name, value]) => {
      const item = value as Record<string, unknown>;
      return {
        name: String(name),
        config: mcpConfig.parse(
          item.url
            ? { ...item, transport: "http" }
            : { ...item, transport: "stdio" },
        ),
      };
    });
  }
  const tokens: string[] = [];
  const pattern = /"((?:\\.|[^"\\])*)"|'([^']*)'|([^\s"']+)/g;
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    if (text.slice(end, match.index).trim())
      throw new Error("配置引号不完整。");
    tokens.push(
      match[1] !== undefined
        ? match[1].replace(/\\(["\\])/g, "$1")
        : (match[2] ?? match[3] ?? ""),
    );
    end = match.index + match[0].length;
  }
  if (text.slice(end).trim()) throw new Error("配置引号不完整。");
  const [cli, area, action, ...args] = tokens;
  if (
    !["claude", "codex"].includes(cli ?? "") ||
    area !== "mcp" ||
    action !== "add"
  )
    throw new Error(
      "请使用 URL、MCP JSON、claude mcp add 或 codex mcp add 配置。",
    );
  let transport = "stdio";
  let url: string | undefined;
  const headers: Record<string, string> = {};
  const env: Record<string, string> = {};
  const positional: string[] = [];
  let command: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) break;
    if (arg === "--") {
      command = args.slice(i + 1);
      break;
    }
    if (
      [
        "--transport",
        "-t",
        "--url",
        "--header",
        "-H",
        "--env",
        "-e",
        "--scope",
        "-s",
      ].includes(arg)
    ) {
      const value = args[++i];
      if (!value) throw new Error("配置参数缺少值。");
      if (["--transport", "-t"].includes(arg)) transport = value;
      if (arg === "--url") {
        url = value;
        transport = "http";
      }
      if (["--header", "-H"].includes(arg)) {
        const at = value.indexOf(":");
        if (at < 1) throw new Error("请求头格式为 Name: value。");
        headers[value.slice(0, at)] = value.slice(at + 1).trim();
      }
      if (["--env", "-e"].includes(arg)) {
        const at = value.indexOf("=");
        if (at < 1) throw new Error("环境变量格式为 NAME=value。");
        env[value.slice(0, at)] = value.slice(at + 1);
      }
    } else if (arg.startsWith("-"))
      throw new Error("此配置选项暂不支持。请使用详细表单。");
    else positional.push(arg);
  }
  const name = positional.shift();
  if (!name) throw new Error("请填写 MCP 名称。");
  if (transport === "http" || transport === "sse")
    return [
      {
        name,
        config: mcpConfig.parse({
          transport: "http",
          url: url ?? positional[0],
          headers,
        }),
      },
    ];
  if (transport !== "stdio") throw new Error("此传输方式暂不支持。");
  command = command.length ? command : positional;
  return [
    {
      name,
      config: mcpConfig.parse({
        transport: "stdio",
        command: command[0],
        args: command.slice(1),
        env,
      }),
    },
  ];
}
