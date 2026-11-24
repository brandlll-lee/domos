import { messageText } from "@domos/agent/messages";
import { chatTranscript } from "@domos/agent/transcript";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { expect, test } from "vitest";
import { botInput, context, setup } from "./fixtures/api.ts";

test("chat accepts consecutive inputs while a reply is running", async () => {
  const { open, faux } = await setup();
  const runtime = await open();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  faux.setResponses([
    async () => {
      started.resolve();
      await release.promise;
      return fauxAssistantMessage("First reply");
    },
    fauxAssistantMessage("Updated reply"),
  ]);
  try {
    const botId = runtime.conversation.id;
    await runtime.client.send({
      botId,
      text: "first",
      requestId: crypto.randomUUID(),
    });
    await started.promise;
    const input = { botId, text: "second", requestId: crypto.randomUUID() };
    const receipt = await runtime.client.send(input);
    expect(await runtime.client.send(input)).toEqual(receipt);
    await runtime.client.send({
      botId,
      text: "third",
      requestId: crypto.randomUUID(),
    });
    release.resolve();
    await runtime.conversation.waitForIdle(context);
    const messages = (await runtime.client.get({ botId })).messages;
    expect(
      messages.filter((message) => message.role === "user").map(messageText),
    ).toEqual(["first", "second", "third"]);
  } finally {
    release.resolve();
    await runtime.harness.close(context);
  }
});

test("contact presence follows each Bot through concurrent runs, cancellation, failure, and reconnect", async () => {
  const { open, faux } = await setup();
  const runtime = await open();
  const second = await runtime.client.bots.create(botInput("Second"));
  const firstId = runtime.conversation.id;
  const events = await runtime.client.bots.subscribe();
  const firstGate = Promise.withResolvers<void>();
  const secondGate = Promise.withResolvers<void>();
  const firstStarted = Promise.withResolvers<void>();
  const secondStarted = Promise.withResolvers<void>();
  faux.setResponses(
    [
      [firstGate, firstStarted],
      [secondGate, secondStarted],
    ].map(([gate, started]) => async (_input, options) => {
      if (!gate || !started) throw new Error("Run gate missing");
      started.resolve();
      options?.signal?.addEventListener("abort", () => gate.resolve(), {
        once: true,
      });
      await gate.promise;
      return fauxAssistantMessage("Finished");
    }),
  );
  const next = async (busy: number[]) => {
    while (true) {
      const event = await events.next();
      if (event.done) throw new Error("Contact stream ended");
      const items = event.value.items;
      if (
        JSON.stringify(
          items.filter((item) => item.busy).map((item) => item.id),
        ) === JSON.stringify(busy)
      )
        return items;
    }
  };
  try {
    expect((await events.next()).value?.items.every((bot) => !bot.busy)).toBe(
      true,
    );
    await runtime.client.send({
      botId: firstId,
      text: "First task",
      requestId: crypto.randomUUID(),
    });
    await next([firstId]);
    await firstStarted.promise;
    await runtime.client.send({
      botId: second.id,
      text: "Second task",
      requestId: crypto.randomUUID(),
    });
    await next([firstId, second.id]);
    await secondStarted.promise;
    const reconnected = await runtime.client.bots.subscribe();
    expect(
      (await reconnected.next()).value?.items.every((bot) => bot.busy),
    ).toBe(true);
    await reconnected.return();
    await runtime.client.stop({ botId: firstId });
    await next([second.id]);
    secondGate.resolve();
    await next([]);
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("read", { path: `${crypto.randomUUID()}.txt` })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("File unavailable"),
    ]);
    await runtime.client.send({
      botId: second.id,
      text: "Read a missing file",
      requestId: crypto.randomUUID(),
    });
    await (await runtime.bots.conversation(second.id, context))?.waitForIdle(
      context,
    );
    expect(
      (await runtime.client.get({ botId: second.id })).messages.some(
        (message) => message.toolStatus === "failed",
      ),
    ).toBe(true);
    expect((await runtime.client.bots.list()).every((bot) => !bot.busy)).toBe(
      true,
    );
  } finally {
    firstGate.resolve();
    secondGate.resolve();
    await events.return();
    await runtime.harness.close(context);
  }
  const restored = await open();
  try {
    expect((await restored.client.bots.list()).every((bot) => !bot.busy)).toBe(
      true,
    );
  } finally {
    await restored.harness.close(context);
  }
});

test("Bot execution, stop, model selection, and history stay independent", async () => {
  const { open, faux, models } = await setup();
  const other = fauxProvider({
    provider: "other",
    models: [{ id: "other-1", name: "Other model" }],
  });
  models.setProvider(other.provider);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const secondEntered = Promise.withResolvers<void>();
  faux.setResponses([
    async () => {
      entered.resolve();
      await release.promise;
      return fauxAssistantMessage("Root answer");
    },
  ]);
  other.setResponses([
    async (_input, options) => {
      secondEntered.resolve();
      await new Promise<void>((resolve) =>
        options?.signal?.addEventListener("abort", () => resolve(), {
          once: true,
        }),
      );
      return fauxAssistantMessage("", { stopReason: "aborted" });
    },
  ]);
  const runtime = await open();
  try {
    const rootId = runtime.conversation.id;
    const bot = await runtime.client.bots.create(botInput("Writer"));
    await runtime.client.models.select({
      botId: bot.id,
      provider: "other",
      modelId: "other-1",
    });
    expect((await runtime.client.get({ botId: rootId })).model).toEqual({
      provider: "faux",
      modelId: "faux-1",
    });
    const events = await runtime.client.subscribe({ botId: rootId });
    await events.next();
    const requestId = crypto.randomUUID();
    await runtime.client.send({
      botId: rootId,
      text: "Root question",
      requestId,
    });
    await entered.promise;
    await events.return();
    await runtime.client.send({
      botId: bot.id,
      text: "Writer question",
      requestId,
    });
    await secondEntered.promise;
    await runtime.client.stop({ botId: bot.id });
    expect((await runtime.client.get({ botId: bot.id })).busy).toBe(false);
    expect((await runtime.client.get({ botId: rootId })).busy).toBe(true);
    release.resolve();
    await runtime.conversation.waitForIdle(context);
    expect(
      (await runtime.client.get({ botId: rootId })).messages.map(messageText),
    ).toEqual(["Root question", "Root answer"]);
    expect(
      (await runtime.client.get({ botId: bot.id })).messages
        .filter((message) => message.role === "user")
        .map(messageText),
    ).toEqual(["Writer question"]);
  } finally {
    release.resolve();
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
    const events = await first.client.subscribe(
      { botId: first.conversation.id },
      {
        signal: controller.signal,
      },
    );
    expect((await events.next()).value).toMatchObject({
      messages: [],
      busy: false,
    });
    const receipt = await first.client.send({
      ...request,
      botId: first.conversation.id,
    });
    await entered.promise;
    const same = await first.client.send({
      ...request,
      botId: first.conversation.id,
    });
    expect(same.id).toBe(receipt.id);
    expect(
      (await first.client.get({ botId: first.conversation.id })).busy,
    ).toBe(true);
    controller.abort();
    await events.return();
    expect(
      (await first.client.get({ botId: first.conversation.id })).busy,
    ).toBe(true);
    release.resolve();
    await first.conversation.waitForIdle(context);
    expect(
      (await first.client.get({ botId: first.conversation.id })).messages.map(
        messageText,
      ),
    ).toEqual(["Remember this", "Saved answer"]);
  } finally {
    release.resolve();
    await first.harness.close(context);
  }
  const second = await open();
  try {
    const events = await second.client.subscribe({
      botId: second.conversation.id,
    });
    expect((await events.next()).value).toMatchObject({
      busy: false,
      messages: [
        { content: [{ type: "text", text: "Remember this" }] },
        { content: [{ type: "text", text: "Saved answer" }] },
      ],
    });
    await events.return();
    expect(
      (await second.client.send({ ...request, botId: second.conversation.id }))
        .id,
    ).toBeDefined();
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
    await first.client.send({
      botId: first.conversation.id,
      text: "Wait",
      requestId: crypto.randomUUID(),
    });
    await entered.promise;
    await expect(
      first.client.send({
        botId: first.conversation.id,
        text: "Another",
        requestId: crypto.randomUUID(),
      }),
    ).resolves.toMatchObject({ id: expect.any(Number) });
    expect(await first.client.stop({ botId: first.conversation.id })).toEqual({
      ok: true,
    });
    expect(
      (await first.client.get({ botId: first.conversation.id })).busy,
    ).toBe(false);
  } finally {
    await first.harness.close(context);
  }
  const second = await open();
  try {
    expect(
      (await second.client.get({ botId: second.conversation.id })).busy,
    ).toBe(false);
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
      client.send({
        botId: conversation.id,
        text: "  ",
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      client.send({
        botId: conversation.id,
        text: "Hello",
        requestId: "bad-id",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(faux.state.callCount).toBe(0);
    await client.send({
      botId: conversation.id,
      text: "Hello",
      requestId: crypto.randomUUID(),
    });
    await conversation.waitForIdle(context);
    const view = await client.get({ botId: conversation.id });
    expect(view.failed).toBe(true);
    expect(JSON.stringify(view)).not.toContain(secret);
    expect(chatTranscript(view).at(-1)).toMatchObject({
      kind: "notice",
      status: "failed",
      error: expect.stringMatching(/^回复失败，原因待确认〔\d+:\d+〕$/),
    });
    faux.setResponses([fauxAssistantMessage("Complete")]);
    await client.send({
      botId: conversation.id,
      text: "Retry",
      requestId: crypto.randomUUID(),
    });
    await conversation.waitForIdle(context);
    const recovered = await client.get({ botId: conversation.id });
    expect(JSON.stringify(recovered)).not.toContain(secret);
    expect(chatTranscript(recovered)).toContainEqual(
      expect.objectContaining({ kind: "notice", status: "failed" }),
    );
  } finally {
    await harness.close(context);
  }
});

test("snapshots retain display content and omit provider signatures and redacted thinking", async () => {
  const { faux, open } = await setup();
  const privateValue = crypto.randomUUID();
  faux.setResponses([
    fauxAssistantMessage([
      {
        type: "thinking",
        thinking: "Visible process",
        thinkingSignature: privateValue,
      },
      {
        type: "thinking",
        thinking: privateValue,
        thinkingSignature: privateValue,
        redacted: true,
      },
      { type: "text", text: "**Saved result**", textSignature: privateValue },
    ]),
  ]);
  const first = await open();
  try {
    await first.client.send({
      botId: first.conversation.id,
      text: "Inspect the response",
      requestId: crypto.randomUUID(),
    });
    await first.conversation.waitForIdle(context);
    const view = await first.client.get({ botId: first.conversation.id });
    expect(view.messages.at(-1)?.content).toEqual([
      expect.objectContaining({
        type: "thinking",
        thinking: "Visible process",
      }),
      expect.objectContaining({ type: "text", text: "**Saved result**" }),
    ]);
    expect(JSON.stringify(view)).not.toContain(privateValue);
  } finally {
    await first.harness.close(context);
  }
  const second = await open();
  try {
    expect(
      (await second.client.get({ botId: second.conversation.id })).messages.at(
        -1,
      )?.content,
    ).toHaveLength(2);
    expect(
      JSON.stringify(
        await second.client.get({ botId: second.conversation.id }),
      ),
    ).not.toContain(privateValue);
  } finally {
    await second.harness.close(context);
  }
});
