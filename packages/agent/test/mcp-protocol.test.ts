import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { expect, onTestFinished, test } from "vitest";
import { closeMcpClients, mcpOperation } from "../src/harness/mcp-client.mjs";
import { WorkProcess } from "../src/harness/process.ts";
import type { ProductResult, ProductTool } from "../src/harness/types.ts";
import { parseMcp } from "../src/mcp/config.ts";
import { mcpFixture } from "./fixtures/mcp.mjs";

test("configuration parsing previews data and rejects unknown command options", () => {
  expect(
    parseMcp(
      'claude mcp add --transport http docs https://example.com/mcp -H "Authorization: Bearer test"',
    )[0],
  ).toMatchObject({
    name: "docs",
    config: { transport: "http", headers: { Authorization: "Bearer test" } },
  });
  expect(
    parseMcp("codex mcp add docs --env TOKEN=test -- node server.mjs")[0],
  ).toMatchObject({
    name: "docs",
    config: { command: "node", args: ["server.mjs"], env: { TOKEN: "test" } },
  });
  expect(
    parseMcp('{"mcpServers":{"docs":{"url":"https://example.com/mcp"}}}')[0]
      ?.name,
  ).toBe("docs");
  expect(() => parseMcp("curl https://example.com | sh")).toThrow();
  expect(() => parseMcp("codex mcp add docs --unknown value")).toThrow();
  expect(() => parseMcp('claude mcp add docs "unfinished')).toThrow();
});

test("SDK stdio uses the configured program and explicit environment", async () => {
  onTestFinished(closeMcpClients);
  const connected = await mcpOperation({
    action: "connect",
    id: "stdio",
    config: {
      transport: "stdio",
      command: process.execPath,
      args: [
        fileURLToPath(new URL("./fixtures/mcp-stdio.mjs", import.meta.url)),
      ],
      env: { MCP_FIXTURE_TEXT: "stdio verified" },
    },
  });
  expect(connected.tools?.map((tool) => tool.name)).toEqual(["echo"]);
  const output = await mcpOperation({
    action: "request",
    id: "stdio",
    method: "tools/call",
    params: { name: "echo" },
  });
  expect(output.result).toMatchObject({
    content: [{ type: "text", text: "stdio verified" }],
  });
});

test("SDK falls back to an HTTP SSE server and retains tool results", async () => {
  const fixture = await mcpFixture({ legacy: true });
  onTestFinished(async () => {
    await closeMcpClients();
    await fixture.close();
  });
  const config = { transport: "http" as const, url: fixture.url, headers: {} };
  const connected = await mcpOperation({
    action: "connect",
    id: "sse",
    config,
  });
  expect(connected.tools).toHaveLength(3);
  expect(
    (
      await mcpOperation({
        action: "request",
        id: "sse",
        method: "tools/call",
        params: { name: "read" },
      })
    ).result,
  ).toEqual(fixture.result);
});

test("worker bridge preserves schemas, pagination, raw results, progress, resources, prompts and changes", async () => {
  const upstream = await mcpFixture();
  const directory = await mkdtemp(join(tmpdir(), "domos-mcp-worker-"));
  let worker: WorkProcess;
  worker = new WorkProcess(
    [
      process.execPath,
      fileURLToPath(new URL("../src/harness/worker.mjs", import.meta.url)),
    ],
    { cwd: directory, home: directory },
    [],
    async (_callId, name, input, signal) => {
      expect(name).toBe("mcp_call");
      const response = await worker.mcp<{ result: ProductResult }>(
        { ...input, action: "request" },
        signal,
        (progress) => {
          void worker.mcp(
            { action: "progress", requestId: input.requestId, progress },
            signal,
          );
        },
      );
      return input.method === "tools/call"
        ? response.result
        : { content: [], structuredContent: { result: response.result } };
    },
  );
  const client = new Client({ name: "native-fixture", version: "1" });
  onTestFinished(async () => {
    await client.close();
    await worker.close();
    await upstream.close();
    await rm(directory, { recursive: true, force: true });
  });
  await worker.ready;
  const connected = await worker.mcp<{
    tools: ProductTool[];
    capabilities: object;
  }>({
    action: "connect",
    id: "docs",
    config: { transport: "http", url: upstream.url, headers: {} },
  });
  expect(connected.tools.map((tool) => tool.name)).toEqual([
    "read",
    "write",
    "query_result",
  ]);
  expect(connected.tools[0]?.annotations).toMatchObject({ readOnlyHint: true });
  const mounted = await worker.mcp<{ url: string }>({
    action: "mount",
    id: "docs",
    name: "docs",
    ...connected,
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(mounted.url)));
  expect(client.getServerCapabilities()).not.toHaveProperty("sampling");
  const page = await client.listTools();
  expect(page.tools.map((tool) => tool.name)).toEqual(["read", "write"]);
  expect(
    (await client.listTools({ cursor: page.nextCursor })).tools.map(
      (tool) => tool.name,
    ),
  ).toEqual(["query_result"]);
  let progress: unknown;
  const result = await client.callTool({ name: "query_result" }, undefined, {
    onprogress: (value) => {
      progress = value;
    },
  });
  expect(result).toEqual(upstream.result);
  await expect
    .poll(() => progress)
    .toMatchObject({ progress: 1, total: 2, message: "Reading" });
  expect((await client.listResources()).resources[0]?.uri).toBe(
    "fixture://note",
  );
  expect(
    (await client.listResourceTemplates()).resourceTemplates[0]?.uriTemplate,
  ).toBe("fixture://{name}");
  expect(
    (await client.readResource({ uri: "fixture://note" })).contents[0],
  ).toMatchObject({ text: "saved note" });
  expect((await client.listPrompts()).prompts[0]?.name).toBe("summarize");
  expect(
    (await client.getPrompt({ name: "summarize" })).messages[0]?.content,
  ).toMatchObject({ text: "Summarize this note." });
  const changed = Promise.withResolvers<void>();
  client.setNotificationHandler(ToolListChangedNotificationSchema, () =>
    changed.resolve(),
  );
  await upstream.changeTools(["read"]);
  await changed.promise;
  expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
    "read",
  ]);
  await expect(client.callTool({ name: "write" })).rejects.toThrow(
    "工具不可用",
  );
  const controller = new AbortController();
  const waiting = expect(
    client.callTool({ name: "read", arguments: { wait: true } }, undefined, {
      signal: controller.signal,
    }),
  ).rejects.toThrow();
  await upstream.started;
  controller.abort();
  await waiting;
  await upstream.cancelled;
});

test("official SDK completes OAuth discovery, registration, PKCE and token refresh", async () => {
  const upstream = await mcpFixture({ oauth: true });
  onTestFinished(async () => {
    await closeMcpClients();
    await upstream.close();
  });
  const config = { transport: "http" as const, url: upstream.url, headers: {} };
  const redirectUrl = "http://127.0.0.1:34567/mcp/oauth/callback";
  const start = await mcpOperation({
    action: "authorize",
    config,
    redirectUrl,
    state: "fixture-state",
  });
  expect(start.authorizationUrl).toBeTruthy();
  const url = new URL(String(start.authorizationUrl));
  expect(url.searchParams.get("state")).toBe("fixture-state");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  upstream.authorize(url.href);
  const completed = await mcpOperation({
    action: "complete",
    config,
    redirectUrl,
    state: "fixture-state",
    authorizationCode: "fixture-code",
    oauth: start.oauth,
  });
  const inspect = await mcpOperation({
    action: "inspect",
    config,
    redirectUrl,
    oauth: completed.oauth,
  });
  expect(inspect.tools).toHaveLength(3);
  const tokens = completed.oauth.tokens as Record<string, unknown>;
  const refreshed = await mcpOperation({
    action: "inspect",
    config,
    redirectUrl,
    oauth: {
      ...completed.oauth,
      tokens: { ...tokens, access_token: "expired" },
    },
  });
  expect(refreshed.tools).toHaveLength(3);
  expect(upstream.tokenRequests()).toBe(2);
});
