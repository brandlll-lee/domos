import type { Credential, CredentialStore } from "@earendil-works/pi-ai";
import { expect, test, vi } from "vitest";
import type { Computers } from "../src/computer/catalog.ts";
import { EngineExecution } from "../src/harness/execution.ts";
import { openGateway } from "../src/harness/gateway.mjs";
import { mcpOperation } from "../src/harness/mcp-client.mjs";
import type { EngineProcess } from "../src/harness/types.ts";
import { McpConnections } from "../src/mcp/connections.ts";
import { mcpFixture } from "./fixtures/mcp.mjs";
import { context, setup } from "./fixtures/work.ts";

function credentials() {
  const records = new Map<string, Credential>();
  const store: CredentialStore = {
    read: async (id) => records.get(id),
    list: async () => [],
    modify: async (id, update) => {
      const value = await update(records.get(id));
      if (value) records.set(id, value);
      return value;
    },
    delete: async (id) => {
      records.delete(id);
    },
  };
  return { store, records };
}

test("connections keep credentials private and enforce Bot and computer grants", async () => {
  const fixture = await setup();
  const runtime = await fixture.open();
  const { store, records } = credentials();
  const service = new McpConnections(runtime.harness, store);
  const id = crypto.randomUUID();
  try {
    const saved = await service.save(
      {
        id,
        revision: 0,
        name: "Notes",
        computerId: "pc",
        enabled: true,
        config: {
          transport: "http",
          url: "https://example.com/mcp?token=secret",
          headers: { authorization: "secret" },
        },
      },
      context,
    );
    expect(JSON.stringify(await service.list(context))).not.toContain("secret");
    await expect(service.resolve(id, 1, "pc", context)).rejects.toThrow();
    const granted = await service.grant(
      id,
      saved.revision,
      [{ botId: 1, tools: ["read"] }],
      context,
    );
    expect((await service.resolve(id, 1, "pc", context)).tools).toEqual([
      "read",
    ]);
    await expect(service.resolve(id, 1, "other", context)).rejects.toThrow();
    await expect(
      service.grant(id, saved.revision, [], context),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await service.remove(id, granted.revision, context);
    expect(records.size).toBe(0);
  } finally {
    await runtime.harness.close(context);
  }
});

test("OAuth cancellation, logout and connection metadata survive Harness restart", async () => {
  const fixture = await setup();
  let runtime = await fixture.open();
  const { store, records } = credentials();
  const upstream = await mcpFixture({ oauth: true });
  let service = new McpConnections(runtime.harness, store);
  service.runner = async (computerId, input, signal) => {
    expect(computerId).toBe("pc");
    return mcpOperation(input, signal);
  };
  const id = crypto.randomUUID();
  try {
    let item = await service.save(
      {
        id,
        revision: 0,
        name: "Notes",
        computerId: "pc",
        enabled: true,
        config: { transport: "http", url: upstream.url, headers: {} },
      },
      context,
    );
    item = await service.grant(
      id,
      item.revision,
      [
        { botId: 1, tools: null },
        { botId: 2, tools: ["read"] },
      ],
      context,
    );
    const login = await service.login(
      id,
      "http://127.0.0.1:34567/mcp/oauth/callback",
      undefined,
      context,
    );
    expect((await service.list(context))[0]?.authorizationPending).toBe(true);
    const state = new URL(String(login.url)).searchParams.get("state") ?? "";
    await service.logout(id, context, true);
    await expect(
      service.complete(state, "fixture-code", context),
    ).rejects.toThrow("失效");
    const again = await service.login(
      id,
      "http://127.0.0.1:34567/mcp/oauth/callback",
      undefined,
      context,
    );
    upstream.authorize(String(again.url));
    const ready = await service.complete(
      new URL(String(again.url)).searchParams.get("state") ?? "",
      "fixture-code",
      context,
    );
    expect(ready.status).toBe("ready");
    expect(ready.authorizationPending).toBeUndefined();
    await runtime.harness.close(context);
    runtime = await fixture.open();
    service = new McpConnections(runtime.harness, store);
    expect((await service.list(context))[0]).toMatchObject({
      name: "Notes",
      status: "ready",
      grants: [{ botId: 1 }, { botId: 2 }],
    });
    item = (await service.resolve(id, 1, "pc", context)).connection;
    await service.logout(id, context);
    await expect(
      service.saveOAuth(
        id,
        item.generation,
        { tokens: { access_token: "stale" } },
        context,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await service.resolve(id, 1, "pc", context)).oauth).toBeUndefined();
    expect(records.size).toBe(1);
  } finally {
    await upstream.close();
    await runtime.harness.close(context);
  }
});

test("MCP tool calls enforce current grants before and after shared approval", async () => {
  const fixture = await setup();
  const runtime = await fixture.open();
  const service = new McpConnections(runtime.harness, credentials().store);
  const execution = new EngineExecution({} as Computers);
  execution.mcp = service;
  const id = crypto.randomUUID();
  let item = await service.save(
    {
      id,
      revision: 0,
      name: "Notes",
      computerId: "pc",
      enabled: true,
      config: {
        transport: "http",
        url: "https://example.com/mcp",
        headers: {},
      },
    },
    context,
  );
  item = await service.grant(
    id,
    item.revision,
    [
      { botId: 1, tools: ["read"] },
      { botId: 2, tools: null },
    ],
    context,
  );
  const raw = {
    content: [{ type: "text" as const, text: "native" }],
    structuredContent: { count: 7 },
  };
  const request = vi.fn(async () => ({ result: raw, oauth: {} }));
  const worker = { mcp: request } as unknown as EngineProcess;
  const approve = vi.fn(async () => ({ allow: true }));
  execution.active.set(1, {
    process: worker,
    controller: new AbortController(),
    memoryReview: false,
    approve,
    managed: new Map([
      [
        id,
        {
          generation: item.generation,
          computerId: "pc",
          worker,
          tools: [
            {
              name: "read",
              description: "Read",
              inputSchema: {
                type: "object",
                properties: { count: { type: "integer" } },
              },
            },
          ],
        },
      ],
    ]),
  });
  const tool = execution.mcpExtension().tools?.[0];
  if (!tool) throw new Error("MCP tool required");
  const api = { conversationId: 1, callId: "fixture-call" } as Parameters<
    typeof tool.execute
  >[1];
  const input = {
    id,
    requestId: "fixture-call",
    method: "tools/call",
    params: { name: "read", arguments: { count: 1 } },
  };
  try {
    expect((await tool.execute(input, api, context)).details).toEqual(raw);
    expect(approve).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
    await expect(
      tool.execute({ ...input, params: { name: "write" } }, api, context),
    ).rejects.toThrow("未授权");
    await expect(
      tool.execute(
        { ...input, params: { name: "read", arguments: { count: "wrong" } } },
        api,
        context,
      ),
    ).rejects.toThrow();
    approve.mockImplementationOnce(async () => {
      item = await service.grant(
        id,
        item.revision,
        [{ botId: 2, tools: null }],
        context,
      );
      return { allow: true };
    });
    await expect(tool.execute(input, api, context)).rejects.toThrow("未授权");
    expect(request).toHaveBeenCalledOnce();
    expect((await service.resolve(id, 2, "pc", context)).tools).toBeNull();
  } finally {
    await runtime.harness.close(context);
  }
});

test("inspects a real Streamable HTTP MCP server", async () => {
  const gateway = await openGateway(
    [{ name: "hello", description: "Hello", inputSchema: { type: "object" } }],
    async () => ({ content: [{ type: "text", text: "hello" }] }),
  );
  try {
    const result = await mcpOperation({
      action: "inspect",
      config: { transport: "http", url: gateway.url, headers: {} },
    });
    expect(result.tools?.map((tool: { name: string }) => tool.name)).toContain(
      "hello",
    );
  } finally {
    await gateway.close();
  }
});
