import { messageText } from "@domos/agent/messages";
import {
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai/providers/faux";
import { expect, test } from "vitest";
import { botInput, context, setup } from "./fixtures/api.ts";

test("Bot creation is atomic, idempotent, observable, and durable", async () => {
  const { open, faux } = await setup();
  const first = await open();
  const input = botInput("Research");
  let botId: number;
  let createdAt: number | undefined;
  try {
    const events = await first.client.bots.subscribe();
    expect((await events.next()).value?.items).toEqual([
      {
        id: first.conversation.id,
        name: "Domos",
        revision: 0,
        avatar: expect.any(String),
        createdAt: expect.any(Number),
        welcomeComplete: false,
        conversations: expect.any(Array),
        busy: false,
        preview: "",
      },
    ]);
    const [bot, repeated] = await Promise.all([
      first.client.bots.create(input),
      first.client.bots.create(input),
    ]);
    botId = bot.id;
    createdAt = bot.createdAt;
    expect(createdAt).toEqual(expect.any(Number));
    expect(repeated).toEqual(bot);
    expect(bot.avatar).toBe(input.avatar);
    let created = await events.next();
    while (!created.done && created.value.items.length !== 2)
      created = await events.next();
    expect(created.value?.items).toEqual([
      {
        id: first.conversation.id,
        name: "Domos",
        revision: 0,
        avatar: expect.any(String),
        createdAt: expect.any(Number),
        welcomeComplete: false,
        conversations: expect.any(Array),
        busy: false,
        preview: "",
      },
      {
        id: bot.id,
        name: bot.name,
        avatar: bot.avatar,
        createdAt: bot.createdAt,
        revision: 0,
        welcomeComplete: false,
        conversations: expect.any(Array),
        busy: false,
        preview: input.instructions,
      },
    ]);
    await events.return();
    const initial = await first.client.get({ botId });
    expect(initial).toMatchObject({
      id: botId,
      model: input.model,
      instructions: input.instructions,
      messages: [],
    });
    faux.setResponses([
      async (request) => {
        expect(JSON.stringify(request)).toContain(input.instructions);
        return fauxAssistantMessage("Research answer");
      },
    ]);
    await first.client.send({
      botId,
      text: "Research question",
      requestId: crypto.randomUUID(),
    });
    await (await first.bots.conversation(botId, context))?.waitForIdle(context);
    expect(
      (await first.client.get({ botId: first.conversation.id })).messages,
    ).toEqual([]);
    await expect(
      first.client.bots.create({ ...botInput(""), name: "  " }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      first.client.bots.create(botInput("Invalid", "missing-model")),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(first.client.get({ botId: -1 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      first.client.send({
        botId: Number.MAX_SAFE_INTEGER,
        text: "Hello",
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await first.client.bots.list()).toHaveLength(2);
  } finally {
    await first.harness.close(context);
  }
  const second = await open();
  try {
    expect(await second.client.bots.create(input)).toEqual({
      id: botId,
      name: input.name,
      avatar: input.avatar,
      createdAt,
      revision: 0,
      instructions: input.instructions,
      model: input.model,
    });
    expect(await second.client.bots.list()).toHaveLength(2);
    const view = await second.client.get({ botId });
    expect(view.model).toEqual(input.model);
    expect(view.instructions).toBe(input.instructions);
    expect(view.messages.map(messageText)).toEqual([
      "Research question",
      "Research answer",
    ]);
  } finally {
    await second.harness.close(context);
  }
});

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
      effort: {
        id: "thinkingLevel",
        kind: "effort",
        label: "推理强度",
        value: "",
        options: [{ id: "off", label: "off" }],
      },
    });
    await first.client.send({
      botId: first.conversation.id,
      text: "First",
      requestId: crypto.randomUUID(),
    });
    await entered.promise;
    await first.client.models.select({
      ...selection,
      botId: first.conversation.id,
    });
    expect(
      (await first.client.get({ botId: first.conversation.id })).model,
    ).toEqual(selection);
    release.resolve();
    await first.conversation.waitForIdle(context);
    expect(faux.state.callCount).toBe(1);
    expect(next.state.callCount).toBe(0);
    await first.client.send({
      botId: first.conversation.id,
      text: "Second",
      requestId: crypto.randomUUID(),
    });
    await first.conversation.waitForIdle(context);
    expect(next.state.callCount).toBe(1);
    await expect(
      first.client.models.select({
        botId: first.conversation.id,
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
    expect(
      (await second.client.get({ botId: second.conversation.id })).model,
    ).toEqual(selection);
    expect(
      (await second.client.get({ botId: second.conversation.id })).messages.map(
        messageText,
      ),
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

test("model visibility is shared, persists after reopening and leaves the selected model intact", async () => {
  const { open } = await setup();
  const first = await open();
  const entry = {
    harness: "pi" as const,
    model: "faux/faux-1",
    visible: false,
  };
  try {
    expect(await first.client.models.visibility()).toEqual([]);
    await first.client.models.setVisibility(entry);
    await first.client.models.setVisibility(entry);
    expect(await first.client.models.visibility()).toEqual([entry]);
    expect(
      (await first.client.get({ botId: first.conversation.id })).model,
    ).toEqual({ provider: "faux", modelId: "faux-1" });
  } finally {
    await first.harness.close(context);
  }
  const second = await open();
  try {
    expect(await second.client.models.visibility()).toEqual([entry]);
    expect(await second.client.models.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: "faux", modelId: "faux-1" }),
      ]),
    );
    await second.client.models.setVisibility({ ...entry, visible: true });
    expect(await second.client.models.visibility()).toEqual([]);
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
    expect(
      (await runtime.client.get({ botId: runtime.conversation.id })).busy,
    ).toBe(false);
    await expect(
      runtime.client.models.select({
        botId: runtime.conversation.id,
        provider: "faux",
        modelId: "faux-1",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      runtime.client.send({
        botId: runtime.conversation.id,
        text: "Wait",
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(faux.state.callCount).toBe(0);
  } finally {
    await runtime.harness.close(context);
  }
});
