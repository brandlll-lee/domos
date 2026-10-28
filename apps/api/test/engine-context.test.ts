import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai/providers/faux";
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

test("Pi thinking defaults reset and incompatible levels clear on model changes", async () => {
  const runtime = await runtimeFixture();
  const reasoning = fauxProvider({
    provider: "reasoning",
    models: [{ id: "smart", reasoning: true }],
  });
  runtime.models.setProvider(reasoning.provider);
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
  await api.models.select({ botId, provider: "reasoning", modelId: "smart" });
  await api.models.thinking({ botId, thinkingLevel: "high" });
  expect((await api.engines.get({ botId })).config.options.thinkingLevel).toBe(
    "high",
  );
  await api.models.thinking({ botId, thinkingLevel: "" });
  expect((await api.engines.get({ botId })).config.options.thinkingLevel).toBe(
    "off",
  );
  await api.models.thinking({ botId, thinkingLevel: "high" });
  await api.models.select({ botId, provider: "faux", modelId: "faux-1" });
  expect((await api.engines.get({ botId })).config.options.thinkingLevel).toBe(
    "off",
  );
  const reopened = await runtime.reopen();
  expect(
    (await reopened.engines.profile(botId, context)).config.options
      .thinkingLevel,
  ).toBe("off");
});

test("Pi refresh publishes an account catalog and reports provider failures", async () => {
  const runtime = await runtimeFixture();
  const dynamic = fauxProvider({ provider: "dynamic" });
  let published = false;
  runtime.models.setProvider({
    ...dynamic.provider,
    getModels: () => (published ? dynamic.models : []),
    refreshModels: async (ctx) => {
      await ctx.publish({
        update: () => {
          published = true;
        },
      });
    },
  });
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
  expect(await api.models.providers()).toContainEqual({
    id: "dynamic",
    name: "dynamic",
    configured: true,
    methods: [],
    dynamic: true,
  });
  expect(
    (await api.models.list()).some((item) => item.provider === "dynamic"),
  ).toBe(false);
  expect(await api.models.refresh({ provider: "dynamic" })).toContainEqual(
    expect.objectContaining({ provider: "dynamic", modelId: "faux-1" }),
  );
  await expect(
    api.models.refresh({ provider: "missing" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  runtime.models.setProvider({
    ...dynamic.provider,
    refreshModels: async () => {
      throw new Error("private provider failure");
    },
  });
  await expect(
    api.models.refresh({ provider: "dynamic" }),
  ).rejects.toMatchObject({
    code: "BAD_GATEWAY",
    message: "模型目录刷新失败。请重试。",
  });
});
