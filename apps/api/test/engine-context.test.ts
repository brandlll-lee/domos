import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { expect, test } from "vitest";
import { runtimeFixture } from "../../../packages/agent/test/fixtures/runtime.ts";
import { createApp } from "../src/app.ts";
import type { AppRouter } from "../src/router.ts";

test("HTTP chat uses Durable context, validates models and reports compaction", async () => {
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
  expect(await api.engines.get({ botId })).toMatchObject({
    config: { provider: "pi", model: "faux/faux-1" },
    prepared: true,
  });
  await expect(
    api.models.select({ botId, provider: "missing", modelId: "missing" }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(
    api.models.thinking({ botId, thinkingLevel: "unknown" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
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
  expect(await api.get({ botId })).toMatchObject({
    busy: false,
    runtime: {
      contextTokens: expect.any(Number),
      contextPolicy: { manual: true, automatic: "native" },
    },
  });
  expect((await api.work.prompt({ botId })).tools).toContain(
    "conversation_read",
  );
  const compactionRequest = {
    botId,
    requestId: crypto.randomUUID(),
  };
  const compact = await api.engines.compact(compactionRequest);
  await runtime.harness.waitForTask(compact.id, context);
  expect(await api.engines.compact(compactionRequest)).toEqual(compact);
  await expect(api.engines.get({ botId: 999999 })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  const reopened = await runtime.reopen();
  expect(
    await reopened.engines.compact(botId, compactionRequest.requestId, context),
  ).toBe(compact.id);
});
