import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  isInitializeRequest,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export async function openGateway(tools, invoke) {
  const path = `/mcp/${randomBytes(32).toString("hex")}`;
  let sequence = 0;
  const sessions = new Map();
  const server = createServer(async (request, response) => {
    if (request.url !== path) {
      response.writeHead(404).end();
      return;
    }
    try {
      let body;
      if (request.method === "POST") {
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
        body = JSON.parse(Buffer.concat(chunks).toString());
      }
      const sessionId = request.headers["mcp-session-id"];
      let session = sessions.get(sessionId);
      if (!session && !sessionId && isInitializeRequest(body)) {
        const mcp = new Server(
          { name: "domos", version: "1.0.0" },
          { capabilities: { tools: {} } },
        );
        mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
        mcp.setRequestHandler(
          CallToolRequestSchema,
          async ({ params }, extra) => {
            if (!tools.some((tool) => tool.name === params.name))
              throw new Error("工具不可用。");
            return invoke(
              `${++sequence}:${extra.requestId}`,
              params.name,
              params.arguments ?? {},
              extra.signal,
            );
          },
        );
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          enableJsonResponse: true,
          onsessioninitialized: (id) => sessions.set(id, { mcp, transport }),
        });
        await mcp.connect(transport);
        const onclose = transport.onclose;
        transport.onclose = () => {
          sessions.delete(transport.sessionId);
          onclose?.();
        };
        session = { mcp, transport };
      }
      if (!session) {
        response.writeHead(sessionId ? 404 : 400).end();
        return;
      }
      await session.transport.handleRequest(request, response, body);
    } catch {
      if (!response.headersSent) response.writeHead(503);
      response.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}${path}`,
    close: async () => {
      await Promise.all([...sessions.values()].map(({ mcp }) => mcp.close()));
      sessions.clear();
      server.close();
      server.closeAllConnections();
    },
  };
}
