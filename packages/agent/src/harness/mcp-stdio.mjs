import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ResultSchema,
} from "@modelcontextprotocol/sdk/types.js";

const client = new Client({ name: "domos-stdio", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(process.argv[2])),
);
const server = new Server(client.getServerVersion(), {
  capabilities: client.getServerCapabilities(),
  instructions: client.getInstructions(),
});
if (process.argv[3] === "--deferred" && client.getServerCapabilities()?.tools) {
  let tools;
  server.setRequestHandler(ListToolsRequestSchema, async (_, extra) => {
    tools = [];
    let cursor;
    do {
      const page = await client.listTools({ cursor }, { signal: extra.signal });
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return {
      tools: tools.length
        ? [
            {
              name: "call_tool",
              description:
                "Access this server's tools. First pass name alone to read the complete tool schema. Then pass name and arguments to execute it. Preserve the tool's arguments and authorization.",
              inputSchema: {
                type: "object",
                properties: {
                  name: {
                    type: "string",
                    enum: tools.map((tool) => tool.name),
                  },
                  arguments: { type: "object", additionalProperties: true },
                },
                required: ["name"],
              },
            },
          ]
        : [],
    };
  });
  server.setRequestHandler(CallToolRequestSchema, async ({ params }, extra) => {
    const tool = tools?.find((tool) => tool.name === params.arguments?.name);
    if (params.name !== "call_tool" || !tool) throw new Error("工具不可用。");
    if (params.arguments.arguments === undefined)
      return { content: [{ type: "text", text: JSON.stringify(tool) }] };
    return client.callTool(
      {
        name: tool.name,
        arguments: params.arguments.arguments,
        _meta: params._meta,
      },
      undefined,
      {
        signal: extra.signal,
        onprogress: (progress) =>
          params._meta?.progressToken === undefined
            ? undefined
            : extra.sendNotification({
                method: "notifications/progress",
                params: {
                  ...progress,
                  progressToken: params._meta.progressToken,
                },
              }),
      },
    );
  });
}
server.fallbackRequestHandler = ({ method, params }, extra) =>
  client.request({ method, params }, ResultSchema, {
    signal: extra.signal,
    onprogress:
      params?._meta?.progressToken === undefined
        ? undefined
        : (progress) =>
            extra.sendNotification({
              method: "notifications/progress",
              params: {
                ...progress,
                progressToken: params._meta.progressToken,
              },
            }),
  });
client.fallbackNotificationHandler = (notification) =>
  server.notification(notification);
server.fallbackNotificationHandler = (notification) =>
  client.notification(notification);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await Promise.all([client.close(), server.close()]);
}
server.onclose = close;
client.onclose = close;
process.stdin.once("end", close);
process.once("SIGTERM", () => {
  void close().finally(() => process.exit());
});
await server.connect(new StdioServerTransport());
