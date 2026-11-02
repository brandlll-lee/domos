import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
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
} from "@modelcontextprotocol/sdk/types.js";

export async function mcpFixture({ oauth = false, legacy = false } = {}) {
  const sessions = new Map();
  const cancelled = Promise.withResolvers();
  const started = Promise.withResolvers();
  const calls = [];
  let tokenRequests = 0;
  let authorization;
  let base;
  let tools = ["read", "write", "query_result"];
  const result = {
    content: [
      { type: "text", text: "native output" },
      { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
    ],
    structuredContent: { value: 7 },
    _meta: { source: "fixture" },
  };
  const http = createServer(async (request, response) => {
    const body = [];
    for await (const chunk of request) body.push(chunk);
    const text = Buffer.concat(body).toString();
    const json = (value, status = 200, headers = {}) => {
      response.writeHead(status, {
        "Content-Type": "application/json",
        ...headers,
      });
      response.end(JSON.stringify(value));
    };
    if (request.url?.startsWith("/.well-known/oauth-protected-resource"))
      return json({ resource: `${base}/mcp`, authorization_servers: [base] });
    if (request.url === "/.well-known/oauth-authorization-server")
      return json({
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    if (request.url?.startsWith("/authorize?")) {
      authorization = new URL(request.url, base);
      const redirect = new URL(authorization.searchParams.get("redirect_uri"));
      redirect.searchParams.set("code", "fixture-code");
      redirect.searchParams.set(
        "state",
        authorization.searchParams.get("state"),
      );
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(
        `<a href="${redirect.href.replaceAll("&", "&amp;")}">批准测试授权</a>`,
      );
      return;
    }
    if (request.url === "/register")
      return json({ ...JSON.parse(text), client_id: "fixture-client" }, 201);
    if (request.url === "/token") {
      const params = new URLSearchParams(text);
      tokenRequests++;
      if (params.get("grant_type") === "authorization_code") {
        const challenge = createHash("sha256")
          .update(params.get("code_verifier") ?? "")
          .digest("base64url");
        if (
          !authorization ||
          challenge !== authorization.searchParams.get("code_challenge")
        )
          return json({ error: "invalid_grant" }, 400);
      }
      return json({
        access_token: "fixture-access",
        token_type: "Bearer",
        refresh_token: "fixture-refresh",
        expires_in: 3600,
      });
    }
    if (legacy && request.url?.startsWith("/messages?")) {
      const id = new URL(request.url, base).searchParams.get("sessionId");
      const session = sessions.get(id);
      if (!session) {
        response.writeHead(404).end();
        return;
      }
      await session.transport.handlePostMessage(
        request,
        response,
        JSON.parse(text),
      );
      return;
    }
    if (request.url !== "/mcp" || (legacy && request.method !== "GET")) {
      response.writeHead(404).end();
      return;
    }
    if (oauth && request.headers.authorization !== "Bearer fixture-access")
      return json({}, 401, {
        "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
      });
    let payload;
    if (text) payload = JSON.parse(text);
    let session = sessions.get(request.headers["mcp-session-id"]);
    if (!session && (legacy || isInitializeRequest(payload))) {
      const server = new Server(
        { name: "fixture", version: "1" },
        {
          capabilities: {
            tools: { listChanged: true },
            resources: {},
            prompts: {},
          },
        },
      );
      server.setRequestHandler(ListToolsRequestSchema, async ({ params }) => {
        const offset = params?.cursor ? Number(params.cursor) : 0;
        return {
          tools: tools.slice(offset, offset + 2).map((name) => ({
            name,
            description: name,
            annotations: { readOnlyHint: name !== "write" },
            inputSchema: {
              type: "object",
              properties: { wait: { type: "boolean" } },
            },
          })),
          ...(offset + 2 < tools.length
            ? { nextCursor: String(offset + 2) }
            : {}),
        };
      });
      server.setRequestHandler(
        CallToolRequestSchema,
        async ({ params }, extra) => {
          calls.push(params.name);
          if (params.arguments?.wait) {
            started.resolve();
            await new Promise((resolve) =>
              extra.signal.addEventListener("abort", resolve, { once: true }),
            );
            cancelled.resolve();
          }
          if (params._meta?.progressToken !== undefined)
            await server.notification(
              {
                method: "notifications/progress",
                params: {
                  progressToken: params._meta.progressToken,
                  progress: 1,
                  total: 2,
                  message: "Reading",
                },
              },
              { relatedRequestId: extra.requestId },
            );
          return result;
        },
      );
      server.setRequestHandler(ListResourcesRequestSchema, async () => ({
        resources: [{ uri: "fixture://note", name: "Note" }],
      }));
      server.setRequestHandler(
        ListResourceTemplatesRequestSchema,
        async () => ({
          resourceTemplates: [
            { uriTemplate: "fixture://{name}", name: "Notes" },
          ],
        }),
      );
      server.setRequestHandler(
        ReadResourceRequestSchema,
        async ({ params }) => ({
          contents: [{ uri: params.uri, text: "saved note" }],
        }),
      );
      server.setRequestHandler(ListPromptsRequestSchema, async () => ({
        prompts: [{ name: "summarize" }],
      }));
      server.setRequestHandler(GetPromptRequestSchema, async () => ({
        messages: [
          {
            role: "user",
            content: { type: "text", text: "Summarize this note." },
          },
        ],
      }));
      const transport = legacy
        ? new SSEServerTransport("/messages", response)
        : new StreamableHTTPServerTransport({
            sessionIdGenerator: randomUUID,
            onsessioninitialized: (id) =>
              sessions.set(id, { server, transport }),
          });
      await server.connect(transport);
      session = { server, transport };
      if (legacy) {
        sessions.set(transport.sessionId, session);
        return;
      }
    }
    if (!session) {
      response.writeHead(400).end();
      return;
    }
    await session.transport.handleRequest(request, response, payload);
  });
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${http.address().port}`;
  return {
    url: `${base}/mcp`,
    result,
    calls,
    started: started.promise,
    cancelled: cancelled.promise,
    tokenRequests: () => tokenRequests,
    authorize(url) {
      authorization = new URL(url);
    },
    async changeTools(names) {
      tools = names;
      await Promise.all(
        [...sessions.values()].map(({ server }) =>
          server.notification({ method: "notifications/tools/list_changed" }),
        ),
      );
    },
    async close() {
      await Promise.all(
        [...sessions.values()].map(({ server }) => server.close()),
      );
      http.closeAllConnections();
      await new Promise((resolve) => http.close(resolve));
    },
  };
}
