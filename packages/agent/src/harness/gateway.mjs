import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export async function openGateway(tools, invoke) {
  const path = `/mcp/${randomBytes(32).toString("hex")}`;
  let sequence = 0;
  const server = createServer(async (request, response) => {
    if (request.url !== path || request.method !== "POST") {
      response.writeHead(404).end();
      return;
    }
    const chunks = [];
    let length = 0;
    for await (const chunk of request) {
      length += chunk.length;
      if (length > 1024 * 1024) {
        response.writeHead(413).end();
        return;
      }
      chunks.push(chunk);
    }
    const mcp = new Server(
      { name: "domos", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
    mcp.setRequestHandler(CallToolRequestSchema, async ({ params }, extra) =>
      invoke(
        `${++sequence}:${extra.requestId}`,
        params.name,
        params.arguments ?? {},
      ),
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await mcp.connect(transport);
      const result = await transport.handleRequest(
        new Request(`http://127.0.0.1${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: Buffer.concat(chunks),
        }),
      );
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(await result.text());
    } catch {
      if (!response.headersSent) response.writeHead(503);
      response.end();
    } finally {
      await mcp.close();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}${path}`,
    close: () => {
      server.close();
      server.closeAllConnections();
    },
  };
}
