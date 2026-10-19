import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, onTestFinished, test } from "vitest";
import { openGateway } from "../src/harness/gateway.mjs";
import type { ProductResult } from "../src/harness/types.ts";

test("MCP callers receive the original screenshot and structured result", async () => {
  const result: ProductResult = {
    content: [
      { type: "image", mimeType: "image/png", data: "c2NyZWVu" },
      { type: "text", text: "Current page" },
    ],
    structuredContent: { url: "https://example.com/", observedAt: 123 },
  };
  const gateway = await openGateway(
    [
      {
        name: "observe",
        description: "Observe",
        inputSchema: { type: "object" },
      },
    ],
    async () => result,
  );
  const client = new Client({ name: "test", version: "1" });
  onTestFinished(async () => {
    await client.close();
    await gateway.close();
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(gateway.url)));
  expect(await client.callTool({ name: "observe" })).toEqual(result);
});

test("cancelling an MCP call stops its work without closing other callers", async () => {
  const entered = Promise.withResolvers<void>();
  const cancelled = Promise.withResolvers<void>();
  const gateway = await openGateway(
    [
      {
        name: "operate",
        description: "Operate",
        inputSchema: { type: "object" },
      },
    ],
    async (_id: string, _name: string, _args: object, signal: AbortSignal) => {
      entered.resolve();
      await new Promise<void>((resolve) =>
        signal.addEventListener(
          "abort",
          () => {
            cancelled.resolve();
            resolve();
          },
          { once: true },
        ),
      );
      return { content: [{ type: "text", text: "Stopped" }] };
    },
  );
  const client = new Client({ name: "test", version: "1" });
  onTestFinished(async () => {
    await client.close();
    await gateway.close();
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(gateway.url)));
  const controller = new AbortController();
  const call = expect(
    client.callTool({ name: "operate" }, undefined, {
      signal: controller.signal,
    }),
  ).rejects.toThrow();
  await entered.promise;
  controller.abort();
  await call;
  await cancelled.promise;
  expect((await client.listTools()).tools[0]?.name).toBe("operate");
});
