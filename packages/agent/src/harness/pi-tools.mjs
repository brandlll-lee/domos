import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export default function (pi) {
  const { url, tools } = JSON.parse(
    readFileSync(process.env.DOMOS_PI_TOOLS, "utf8"),
  );
  const client = new Client({ name: "domos-pi", version: "1" });
  let connected;
  const connect = () =>
    (connected ??= client.connect(
      new StreamableHTTPClientTransport(new URL(url)),
    ));
  for (const tool of tools)
    pi.registerTool({
      name: `mcp__domos__${tool.name}`,
      label: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      async execute(_id, args, signal) {
        await connect();
        const result = await client.callTool(
          { name: tool.name, arguments: args },
          undefined,
          { signal },
        );
        return {
          content: result.content.map((part) =>
            ["text", "image"].includes(part.type)
              ? part
              : { type: "text", text: JSON.stringify(part) },
          ),
          structuredContent: result.structuredContent,
          isError: result.isError,
          details: result,
        };
      },
    });
  pi.on("session_start", async () => {
    await connect();
    const catalog = await client.listTools();
    if (
      tools.some(
        (tool) => !catalog.tools.some((item) => item.name === tool.name),
      )
    )
      throw new Error("Domos 工具目录不完整。");
    pi.setActiveTools([
      ...new Set([
        ...pi.getActiveTools(),
        ...tools.map((tool) => `mcp__domos__${tool.name}`),
      ]),
    ]);
  });
  pi.on("session_shutdown", async () => {
    await client.close();
    connected = undefined;
  });
  registerPiApprovals(pi);
}

export function registerPiApprovals(pi) {
  pi.on("tool_call", async (event, ctx) => {
    if (!["bash", "powershell", "write", "edit"].includes(event.toolName))
      return;
    if (
      !(await ctx.ui.confirm("Computer operation", JSON.stringify(event.input)))
    )
      return { block: true, reason: "Operation was not approved." };
  });
  if (process.platform === "win32")
    pi.on("session_start", () => {
      pi.setActiveTools([
        ...pi.getActiveTools().filter((name) => name !== "bash"),
        "powershell",
      ]);
    });
}
