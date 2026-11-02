import {
  auth,
  UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CallToolResultSchema,
  EmptyResultSchema,
  GetPromptResultSchema,
  ListPromptsResultSchema,
  ListResourcesResultSchema,
  ListResourceTemplatesResultSchema,
  ListToolsResultSchema,
  PromptListChangedNotificationSchema,
  ReadResourceResultSchema,
  ResourceListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";

const connections = new Map();
const schemas = {
  "tools/list": ListToolsResultSchema,
  "tools/call": CallToolResultSchema,
  "resources/list": ListResourcesResultSchema,
  "resources/templates/list": ListResourceTemplatesResultSchema,
  "resources/read": ReadResourceResultSchema,
  "prompts/list": ListPromptsResultSchema,
  "prompts/get": GetPromptResultSchema,
  "resources/subscribe": EmptyResultSchema,
  "resources/unsubscribe": EmptyResultSchema,
};

function provider(input, oauth) {
  return {
    redirectUrl: input.redirectUrl,
    clientMetadata: {
      client_name: "Domos",
      redirect_uris: [input.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    state: () => input.state,
    clientInformation: () => oauth.client,
    saveClientInformation: (client) => {
      oauth.client = client;
    },
    tokens: () => oauth.tokens,
    saveTokens: (tokens) => {
      oauth.tokens = tokens;
    },
    redirectToAuthorization: (url) => {
      oauth.authorizationUrl = url.href;
    },
    saveCodeVerifier: (verifier) => {
      oauth.verifier = verifier;
    },
    codeVerifier: () => {
      if (!oauth.verifier) throw new Error("授权请求已失效。");
      return oauth.verifier;
    },
    discoveryState: () => oauth.discovery,
    saveDiscoveryState: (discovery) => {
      oauth.discovery = discovery;
    },
    invalidateCredentials: (scope) => {
      if (scope === "all" || scope === "tokens") delete oauth.tokens;
      if (scope === "all" || scope === "client") delete oauth.client;
      if (scope === "all" || scope === "verifier") delete oauth.verifier;
      if (scope === "all" || scope === "discovery") delete oauth.discovery;
    },
  };
}

export async function openMcpClient(input, signal) {
  signal?.throwIfAborted();
  const { config } = input;
  if (!config) throw new Error("MCP 配置不存在。");
  const oauth = { ...input.oauth };
  delete oauth.authorizationUrl;
  if (input.action === "authorize" || input.action === "complete") {
    if (config.transport !== "http" || !input.redirectUrl || !input.state)
      throw new Error("授权配置不完整。");
    const result = await auth(provider(input, oauth), {
      serverUrl: config.url,
      ...(input.action === "complete"
        ? { authorizationCode: input.authorizationCode }
        : {}),
      fetchFn: (url, init) => fetch(url, { ...init, signal }),
    });
    if (input.action === "complete" && result !== "AUTHORIZED")
      throw new Error("授权未完成。");
    return { authorizationUrl: oauth.authorizationUrl, oauth };
  }
  const authProvider = input.redirectUrl ? provider(input, oauth) : undefined;
  const options = {
    authProvider,
    requestInit: { headers: config.headers },
    fetch: (url, init) => fetch(url, { ...init, signal }),
  };
  let client;
  let transport;
  const connect = async (legacy = false) => {
    client = new Client({ name: "domos", version: "1.0.0" });
    transport =
      config.transport === "stdio"
        ? new StdioClientTransport({
            command: config.command,
            args: config.args,
            env: config.env,
            stderr: "pipe",
          })
        : legacy
          ? new SSEClientTransport(new URL(config.url), options)
          : new StreamableHTTPClientTransport(new URL(config.url), options);
    transport.stderr?.resume();
    const abort = () => void client.close();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await client.connect(transport);
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  };
  try {
    try {
      await connect();
    } catch (error) {
      await client?.close().catch(() => {});
      if (
        config.transport !== "http" ||
        error instanceof UnauthorizedError ||
        ![400, 404, 405, 406].includes(error?.code)
      )
        throw error;
      await connect(true);
    }
    return { client, oauth, close: () => client.close() };
  } catch (error) {
    await client?.close().catch(() => {});
    throw error;
  }
}

export async function mcpOperation(input, signal, onprogress, onnotification) {
  if (input.action === "request") {
    const opened = connections.get(input.id);
    const schema = schemas[input.method];
    if (!opened || !schema) throw new Error("MCP 会话或操作不可用。");
    const result = await opened.client.request(
      { method: input.method, params: input.params },
      schema,
      { signal, onprogress },
    );
    return { result, oauth: opened.oauth };
  }
  if (input.action === "disconnect") {
    const opened = connections.get(input.id);
    connections.delete(input.id);
    await opened?.close();
    return { oauth: {} };
  }
  const opened = await openMcpClient(input, signal);
  if (!opened.client) return opened;
  const { client, oauth } = opened;
  try {
    const capabilities = client.getServerCapabilities() ?? {};
    const tools = [];
    if (capabilities.tools) {
      let cursor;
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined, {
          signal,
        });
        tools.push(...page.tools);
        cursor = page.nextCursor;
      } while (cursor);
    }
    if (input.action === "connect") {
      for (const schema of [
        ToolListChangedNotificationSchema,
        ResourceListChangedNotificationSchema,
        ResourceUpdatedNotificationSchema,
        PromptListChangedNotificationSchema,
      ])
        client.setNotificationHandler(schema, (notification) =>
          onnotification?.(notification),
        );
      connections.set(input.id, opened);
    }
    return { capabilities, tools, oauth };
  } finally {
    if (input.action !== "connect" || !connections.has(input.id))
      await opened.close().catch(() => {});
  }
}

export async function closeMcpClients() {
  await Promise.all(
    [...connections.values()].map((item) => item.close().catch(() => {})),
  );
  connections.clear();
}
