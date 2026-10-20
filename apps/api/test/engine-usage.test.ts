import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAgent } from "@domos/agent";
import type { Computers } from "@domos/agent/computer/catalog";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry } from "@earendil-works/pi-durable";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { expect, onTestFinished, test } from "vitest";
import { ProtocolProcess } from "../../../packages/agent/test/fixtures/engine-process.ts";
import { createApp } from "../src/app.ts";
import type { AppRouter } from "../src/router.ts";

test("HTTP usage retains native attribution, deduplicates and survives reopening", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-usage-"));
  const models = createModels();
  models.setProvider(fauxProvider().provider);
  const computers = {
    initialize: async () => {},
    preflight: async () => {},
    computerId: async () => "local",
    tools: { catalog: async () => [], finish: () => {} },
    process: async () => {
      const process = new ProtocolProcess();
      process.receive = (request) => {
        process.frame({
          type: "response",
          id: request.id,
          success: true,
          data:
            request.type === "get_state"
              ? { sessionFile: "/native/session" }
              : {},
        });
        if (request.type === "prompt") {
          const message = {
            role: "assistant",
            timestamp: 100,
            provider: "test-provider",
            model: "test-model",
            stopReason: "stop",
            content: [{ type: "text", text: "Done" }],
            usage: { input: 12, output: 4, cacheRead: 3, cacheWrite: 0 },
          };
          process.frame({ type: "message_start", message });
          process.frame({ type: "message_end", message });
          process.frame({ type: "message_end", message });
          process.frame({ type: "agent_settled" });
        }
      };
      return process;
    },
  } as unknown as Computers;
  const open = async () => {
    const runtime = await openAgent(
      join(directory, "agent.sqlite"),
      { models, registry: createRegistry(), computers },
      {},
      context,
    );
    const app = createApp(
      runtime.bots,
      models,
      runtime.files,
      runtime.work,
      undefined,
      undefined,
      runtime.engines,
    );
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({
        url: "http://localhost/rpc",
        fetch: async (request, init) => app.fetch(new Request(request, init)),
      }),
    );
    return { ...runtime, client };
  };
  let runtime = await open();
  onTestFinished(async () => {
    await runtime.harness.close(context);
    await rm(directory, { recursive: true, force: true });
  });
  const botId = runtime.conversation.id;
  const submission = await runtime.client.send({
    botId,
    text: "Work",
    requestId: crypto.randomUUID(),
  });
  await runtime.harness
    .submission(submission.id, context)
    .then((item) => item?.wait(context));
  const rows = await runtime.client.engines.usage({});
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    botId,
    harness: "pi",
    provider: "test-provider",
    model: "test-model",
    input: 12,
    output: 4,
    cacheRead: 3,
    costUsd: null,
    source: "pi.message_end",
  });
  expect(rows[0]?.taskId).toBeTruthy();
  expect(await runtime.client.engines.usage({ provider: "other" })).toEqual([]);
  const before = await runtime.client.get({ botId });
  const compact = await runtime.client.engines.compact({
    botId,
    requestId: crypto.randomUUID(),
  });
  await runtime.harness
    .submission(compact.id, context)
    .then((item) => item?.wait(context));
  const after = await runtime.client.get({ botId });
  expect(after.messages).toEqual(before.messages);
  expect(
    (await runtime.client.engines.get({ botId })).runtime?.compaction,
  ).toBe("completed");
  await runtime.harness.close(context);
  runtime = await open();
  expect(await runtime.client.engines.usage({})).toEqual(rows);
});
