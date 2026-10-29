import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  isInitializeRequest,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

function structuredText(result) {
  const texts = result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text);
  function copy(value) {
    if (typeof value === "string") {
      if (value.length >= 256 && texts.some((text) => text.includes(value)))
        return "[see result text]";
      if (
        value.length >= 1024 &&
        (/^[A-Za-z0-9+/\r\n]+=*$/u.test(value) || value.startsWith("data:"))
      )
        return "[binary data retained in evidence]";
      return value;
    }
    if (Array.isArray(value)) return value.map(copy);
    if (!value || typeof value !== "object") return value;
    const entries = Object.entries(value).filter(
      ([key]) =>
        !(
          value.snapshot_id &&
          Array.isArray(value.elements) &&
          ["elements", "_note"].includes(key)
        ),
    );
    return {
      ...Object.fromEntries(entries.map(([key, item]) => [key, copy(item)])),
      ...(value.snapshot_id && Array.isArray(value.elements)
        ? {
            element_address:
              "Use pid, window_id, snapshot_id and the tree's element_index.",
          }
        : {}),
    };
  }
  const json = JSON.stringify(copy(result.structuredContent));
  return json.length <= 65536
    ? json
    : `${json.slice(0, 65536).replace(/[\uD800-\uDBFF]$/u, "")}\n[Text copy limited. Request a smaller query/max_elements. Native output is retained.]`;
}

export async function openGateway(tools, invoke) {
  const listed = Promise.withResolvers();
  if (!tools.length) listed.resolve();
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
        mcp.setRequestHandler(ListToolsRequestSchema, async () => {
          listed.resolve();
          return { tools };
        });
        mcp.setRequestHandler(
          CallToolRequestSchema,
          async ({ params }, extra) => {
            if (!tools.some((tool) => tool.name === params.name))
              throw new Error("工具不可用。");
            const result = await invoke(
              `${++sequence}:${extra.requestId}`,
              params.name,
              params.arguments ?? {},
              extra.signal,
            );
            return result.structuredContent === undefined
              ? result
              : {
                  ...result,
                  content: [
                    ...result.content,
                    {
                      type: "text",
                      text: structuredText(result),
                    },
                  ],
                };
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
    async ready() {
      const controller = new AbortController();
      try {
        await Promise.race([
          listed.promise,
          delay(30000, undefined, {
            signal: controller.signal,
            ref: false,
          }).then(() => {
            throw new Error(
              "Harness 尚未读取 Domos 工具目录。请检查原生工具连接。",
            );
          }),
        ]);
      } finally {
        controller.abort();
      }
    },
    close: async () => {
      await Promise.all([...sessions.values()].map(({ mcp }) => mcp.close()));
      sessions.clear();
      server.close();
      server.closeAllConnections();
    },
  };
}
