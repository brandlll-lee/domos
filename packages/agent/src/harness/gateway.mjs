import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  isInitializeRequest,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { openToolResults, resultQueryTool } from "./tool-results.mjs";

export async function openGateway(tools, invoke, options) {
  const results = options ? undefined : openToolResults();
  const listed = Promise.withResolvers();
  if (!tools.length) listed.resolve();
  tools = options ? tools : [...tools, resultQueryTool];
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
          { name: options?.name ?? "domos", version: "1.0.0" },
          {
            capabilities: options
              ? {
                  ...(options.capabilities.tools
                    ? { tools: options.capabilities.tools }
                    : {}),
                  ...(options.capabilities.resources
                    ? { resources: options.capabilities.resources }
                    : {}),
                  ...(options.capabilities.prompts
                    ? { prompts: options.capabilities.prompts }
                    : {}),
                }
              : { tools: {} },
          },
        );
        if (!options || options.capabilities.tools) {
          mcp.setRequestHandler(
            ListToolsRequestSchema,
            async (request, extra) => {
              listed.resolve();
              if (options) {
                const result = await options.request(
                  `${++sequence}:${extra.requestId}`,
                  request.method,
                  request.params ?? {},
                  extra.signal,
                );
                const page = result.structuredContent.result;
                tools = request.params?.cursor
                  ? [...tools, ...page.tools]
                  : page.tools;
                return page;
              }
              return { tools };
            },
          );
          mcp.setRequestHandler(
            CallToolRequestSchema,
            async ({ params }, extra) => {
              if (!tools.some((tool) => tool.name === params.name))
                throw new Error("工具不可用。");
              if (!options && params.name === resultQueryTool.name)
                return results.query(params.arguments ?? {});
              const result = await invoke(
                `${++sequence}:${extra.requestId}`,
                params.name,
                params.arguments ?? {},
                extra.signal,
                params._meta,
                (progress) =>
                  params._meta?.progressToken === undefined
                    ? undefined
                    : mcp.notification(
                        {
                          method: "notifications/progress",
                          params: {
                            ...progress,
                            progressToken: params._meta.progressToken,
                          },
                        },
                        { relatedRequestId: extra.requestId },
                      ),
              );
              return options ? result : results.project(result);
            },
          );
        }
        if (options) {
          for (const [capability, schema, subscription] of [
            ["resources", ListResourcesRequestSchema],
            ["resources", ListResourceTemplatesRequestSchema],
            ["resources", ReadResourceRequestSchema],
            ["resources", SubscribeRequestSchema, true],
            ["resources", UnsubscribeRequestSchema, true],
            ["prompts", ListPromptsRequestSchema],
            ["prompts", GetPromptRequestSchema],
          ]) {
            if (
              options.capabilities[capability] &&
              (!subscription || options.capabilities.resources?.subscribe)
            )
              mcp.setRequestHandler(schema, async (request, extra) => {
                const result = await options.request(
                  `${++sequence}:${extra.requestId}`,
                  request.method,
                  request.params ?? {},
                  extra.signal,
                  (progress) =>
                    request.params?._meta?.progressToken === undefined
                      ? undefined
                      : mcp.notification(
                          {
                            method: "notifications/progress",
                            params: {
                              ...progress,
                              progressToken: request.params._meta.progressToken,
                            },
                          },
                          { relatedRequestId: extra.requestId },
                        ),
                );
                return result.structuredContent.result;
              });
          }
        }
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          enableJsonResponse: !options,
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
    async notify(notification) {
      await Promise.all(
        [...sessions.values()].map(({ mcp }) => mcp.notification(notification)),
      );
    },
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
