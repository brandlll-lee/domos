import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { expect, test } from "vitest";
import { EngineUsageEntry } from "../../../packages/agent/src/harness/usage.ts";
import { runtimeFixture } from "../../../packages/agent/test/fixtures/runtime.ts";
import { createApp } from "../src/app.ts";
import type { AppRouter } from "../src/router.ts";

test("HTTP usage retains historical attribution and native usage across reopening", async () => {
  const runtime = await runtimeFixture();
  const app = createApp(
    runtime.bots,
    runtime.models,
    runtime.files,
    runtime.work,
    undefined,
    undefined,
    runtime.engines,
  );
  const api = createORPCClient<RouterClient<AppRouter>>(
    new RPCLink({
      url: "http://domos/rpc",
      fetch: async (request, init) => app.fetch(new Request(request, init)),
    }),
  );
  const botId = runtime.conversation.id;
  await runtime.harness.commit(async (tx) => {
    await tx.appendEntry(botId, {
      kind: EngineUsageEntry,
      data: {
        id: "old",
        source: "codex",
        provider: "openai",
        model: "old-model",
        input: 12,
        output: 4,
        cacheRead: 3,
        cacheWrite: 0,
        costUsd: 0.1,
        botId,
        harness: "codex",
        taskId: "old",
        sessionId: "native",
        timestamp: 100,
      },
    });
  }, context);
  runtime.faux.setResponses([fauxAssistantMessage("Reply")]);
  const response = await api.send({
    botId,
    text: "Hello",
    requestId: crypto.randomUUID(),
  });
  await runtime.harness.submission(response.id, context).then((item) => {
    if (!item) throw new Error("Submission required");
    return item.wait(context);
  });
  const all = await api.engines.usage({});
  expect(all).toHaveLength(2);
  expect(all).toContainEqual(
    expect.objectContaining({
      harness: "pi",
      provider: "faux",
      model: "faux-1",
      input: expect.any(Number),
      output: expect.any(Number),
      costUsd: expect.any(Number),
    }),
  );
  expect(
    await api.engines.usage({ harness: "codex", from: 100, to: 100 }),
  ).toMatchObject([{ id: "old", sessionId: "native" }]);
  const reopened = await runtime.reopen();
  expect(await reopened.engines.usage([botId], {}, context)).toEqual(all);
});
