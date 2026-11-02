import type { Credential } from "@earendil-works/pi-ai";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { expect, test } from "vitest";
import { mcpOperation } from "../../../packages/agent/src/harness/mcp-client.mjs";
import { McpConnections } from "../../../packages/agent/src/mcp/connections.ts";
import { mcpFixture } from "../../../packages/agent/test/fixtures/mcp.mjs";
import { context, setup } from "../../../packages/agent/test/fixtures/work.ts";
import { createApp } from "../src/app.ts";
import type { AppRouter } from "../src/router.ts";

test("MCP RPC preserves null tool scope and validates Bot grants", async () => {
  const fixture = await setup();
  const runtime = await fixture.open();
  const upstream = await mcpFixture();
  const records = new Map<string, Credential>();
  const service = new McpConnections(runtime.harness, {
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
  });
  service.runner = (_computerId, input, signal) => mcpOperation(input, signal);
  const app = createApp(
    runtime.bots,
    {} as Parameters<typeof createApp>[1],
    runtime.files,
    runtime.work,
    undefined,
    undefined,
    undefined,
    service,
  );
  const client: RouterClient<AppRouter> = createORPCClient(
    new RPCLink({
      url: "http://localhost/rpc",
      fetch: async (request, init) => app.fetch(new Request(request, init)),
    }),
  );
  try {
    const item = await client.mcp.save({
      id: crypto.randomUUID(),
      revision: 0,
      name: "Docs",
      computerId: "pc",
      enabled: true,
      config: { transport: "http", url: upstream.url, headers: {} },
    });
    expect((await client.mcp.check({ id: item.id })).tools).toHaveLength(3);
    const granted = await client.mcp.grant({
      id: item.id,
      revision: item.revision,
      grants: [{ botId: runtime.conversation.id, tools: null }],
    });
    expect(granted.grants).toEqual([
      { botId: runtime.conversation.id, tools: null },
    ]);
    expect(granted.tools?.[0]?.annotations).toMatchObject({
      readOnlyHint: true,
    });
    await expect(
      client.mcp.grant({
        id: item.id,
        revision: granted.revision,
        grants: [{ botId: 999999, tools: null }],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  } finally {
    await upstream.close();
    await runtime.harness.close(context);
  }
});
