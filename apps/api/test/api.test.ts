import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAgent } from "@domos/agent";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai/providers/faux";
import { createRegistry } from "@earendil-works/pi-durable";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { expect, onTestFinished, test } from "vitest";
import { createApp } from "../src/app.ts";
import type { AppRouter } from "../src/router.ts";

const context = BACKGROUND_CONTEXT;

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "domos-api-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const options = { models, registry: createRegistry() };
  const agent = { model: { provider: "faux", modelId: "faux-1" } };
  const open = async () => {
    const runtime = await openAgent(
      join(directory, "agent.sqlite"),
      options,
      agent,
      context,
    );
    const app = createApp(runtime.conversation, models);
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({
        url: "http://localhost/rpc",
        fetch: async (request, init) => app.fetch(new Request(request, init)),
      }),
    );
    return { ...runtime, client, app };
  };
  return { faux, open, models };
}

test("SDK models can be selected, persist after reopening and leave active requests pinned", async () => {
  const { faux, open, models } = await setup();
  const next = fauxProvider({
    provider: crypto.randomUUID(),
    models: [{ id: crypto.randomUUID(), name: "New catalog model" }],
  });
  models.setProvider(next.provider);
  next.setResponses([fauxAssistantMessage("Next model answer")]);
  const selection = { provider: next.provider.id, modelId: next.models[0].id };
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  faux.setResponses([
    async () => {
      entered.resolve();
      await release.promise;
      return fauxAssistantMessage("Original model answer");
    },
  ]);
  const first = await open();
  try {
    expect(await first.client.models.list()).toContainEqual({
      ...selection,
      name: "New catalog model",
      providerName: next.provider.name,
    });
    await first.client.send({ text: "First", requestId: crypto.randomUUID() });
    await entered.promise;
    await first.client.models.select(selection);
    expect((await first.client.get()).model).toEqual(selection);
    release.resolve();
    await first.conversation.waitForIdle(context);
    expect(faux.state.callCount).toBe(1);
    expect(next.state.callCount).toBe(0);
    await first.client.send({ text: "Second", requestId: crypto.randomUUID() });
    await first.conversation.waitForIdle(context);
    expect(next.state.callCount).toBe(1);
    await expect(
      first.client.models.select({
        provider: crypto.randomUUID(),
        modelId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  } finally {
    release.resolve();
    await first.harness.close(context);
  }
  const second = await open();
  try {
    expect((await second.client.get()).model).toEqual(selection);
    expect(
      (await second.client.get()).messages.map((message) => message.text),
    ).toEqual([
      "First",
      "Original model answer",
      "Second",
      "Next model answer",
    ]);
  } finally {
    await second.harness.close(context);
  }
});

test("unconfigured models leave history accessible and reject execution", async () => {
  const { faux, open } = await setup();
  if (faux.provider.auth.apiKey)
    faux.provider.auth.apiKey.resolve = async () => undefined;
  const runtime = await open();
  try {
    expect(await runtime.client.models.list()).toEqual([]);
    expect((await runtime.client.get()).busy).toBe(false);
    await expect(
      runtime.client.models.select({ provider: "faux", modelId: "faux-1" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      runtime.client.send({ text: "Wait", requestId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(faux.state.callCount).toBe(0);
  } finally {
    await runtime.harness.close(context);
  }
});

test("HTTP subscription starts with a snapshot and detaching keeps the run alive", async () => {
  const { faux, open } = await setup();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  faux.setResponses([
    async () => {
      entered.resolve();
      await release.promise;
      return fauxAssistantMessage("Saved answer");
    },
  ]);
  const first = await open();
  const request = { text: "Remember this", requestId: crypto.randomUUID() };
  try {
    const controller = new AbortController();
    const events = await first.client.subscribe(undefined, {
      signal: controller.signal,
    });
    expect((await events.next()).value).toMatchObject({
      messages: [],
      busy: false,
    });
    const receipt = await first.client.send(request);
    await entered.promise;
    const same = await first.client.send(request);
    expect(same.id).toBe(receipt.id);
    expect((await first.client.get()).busy).toBe(true);
    controller.abort();
    await events.return();
    expect((await first.client.get()).busy).toBe(true);
    release.resolve();
    await first.conversation.waitForIdle(context);
    expect(
      (await first.client.get()).messages.map((message) => message.text),
    ).toEqual(["Remember this", "Saved answer"]);
  } finally {
    release.resolve();
    await first.harness.close(context);
  }
  const second = await open();
  try {
    const events = await second.client.subscribe();
    expect((await events.next()).value).toMatchObject({
      busy: false,
      messages: [{ text: "Remember this" }, { text: "Saved answer" }],
    });
    await events.return();
    expect((await second.client.send(request)).id).toBeDefined();
    expect(faux.state.callCount).toBe(1);
  } finally {
    await second.harness.close(context);
  }
});

test("stop cancels the task and the stopped result survives reopening", async () => {
  const { faux, open } = await setup();
  const entered = Promise.withResolvers<void>();
  faux.setResponses([
    async (_input, options) => {
      entered.resolve();
      await new Promise<void>((resolve) => {
        options?.signal?.addEventListener("abort", () => resolve(), {
          once: true,
        });
      });
      return fauxAssistantMessage("", { stopReason: "aborted" });
    },
  ]);
  const first = await open();
  try {
    await first.client.send({ text: "Wait", requestId: crypto.randomUUID() });
    await entered.promise;
    await expect(
      first.client.send({ text: "Another", requestId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await first.client.stop()).toEqual({ ok: true });
    expect((await first.client.get()).busy).toBe(false);
  } finally {
    await first.harness.close(context);
  }
  const second = await open();
  try {
    expect((await second.client.get()).busy).toBe(false);
    expect(faux.state.callCount).toBe(1);
  } finally {
    await second.harness.close(context);
  }
});

test("validation rejects empty input and snapshots hide provider error details", async () => {
  const { faux, open } = await setup();
  const secret = "synthetic-private-error";
  faux.setResponses([
    fauxAssistantMessage(secret, { stopReason: "error", errorMessage: secret }),
  ]);
  const { client, harness, conversation } = await open();
  try {
    await expect(
      client.send({ text: "  ", requestId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      client.send({ text: "Hello", requestId: "bad-id" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(faux.state.callCount).toBe(0);
    await client.send({ text: "Hello", requestId: crypto.randomUUID() });
    await conversation.waitForIdle(context);
    const view = await client.get();
    expect(view.error).toBeTruthy();
    expect(JSON.stringify(view)).not.toContain(secret);
  } finally {
    await harness.close(context);
  }
});
