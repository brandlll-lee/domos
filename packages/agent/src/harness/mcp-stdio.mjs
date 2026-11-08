import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ResultSchema } from "@modelcontextprotocol/sdk/types.js";

const client = new Client({ name: "domos-stdio", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(process.argv[2])),
);
const server = new Server(client.getServerVersion(), {
  capabilities: client.getServerCapabilities(),
  instructions: client.getInstructions(),
});
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
