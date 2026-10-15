import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAgent } from "@domos/agent";
import { Files } from "@domos/agent/files";
import { messageText } from "@domos/agent/messages";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { createRegistry } from "@earendil-works/pi-durable";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { expect, onTestFinished, test } from "vitest";
import { createApp } from "../src/app.ts";
import type { AppRouter } from "../src/router.ts";

const context = BACKGROUND_CONTEXT;

const botInput = (name: string, modelId = "faux-1") => ({
  name,
  instructions: `Work as ${name}.`,
  model: { provider: "faux", modelId },
  requestId: crypto.randomUUID(),
  avatar: crypto.randomUUID(),
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "domos-api-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const database = join(directory, "agent.sqlite");
  const files = new Files(database);
  const registry = createRegistry();
  registry.install(files.extension());
  const options = {
    models,
    registry,
    env: ({ conversationId }: { conversationId: number }) =>
      files.workspace(conversationId),
  };
  const agent = { model: { provider: "faux", modelId: "faux-1" } };
  const open = async () => {
    const runtime = await openAgent(database, options, agent, context);
    const app = createApp(runtime.bots, models, runtime.files);
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

test("Bot creation is atomic, idempotent, observable, and durable", async () => {
  const { open, faux } = await setup();
  const first = await open();
  const input = botInput("Research");
  let botId: number;
  try {
    const events = await first.client.bots.subscribe();
    expect((await events.next()).value).toEqual([
      { id: first.conversation.id, name: "Domos", avatar: expect.any(String) },
    ]);
    const [bot, repeated] = await Promise.all([
      first.client.bots.create(input),
      first.client.bots.create(input),
    ]);
    botId = bot.id;
    expect(repeated).toEqual(bot);
    expect(bot.avatar).toBe(input.avatar);
    expect((await events.next()).value).toEqual([
      { id: first.conversation.id, name: "Domos", avatar: expect.any(String) },
      bot,
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

test("image previews use file content, retain Bot ownership, and restore stored images", async () => {
  const { open } = await setup();
  const first = await open();
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=",
    "base64",
  );
  let image: Awaited<ReturnType<typeof first.files.upload>>;
  const botId = first.conversation.id;
  try {
    image = await first.client.files.upload({
      botId,
      file: new File([bytes], "source.dat", { type: "text/plain" }),
    });
    expect(image.mimeType).toBe("image/png");
    const preview = await first.app.request(`/files/${botId}/${image.id}`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("Content-Type")).toBe("image/png");
    expect(preview.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(Buffer.from(await preview.arrayBuffer())).toEqual(bytes);
    const other = await first.client.bots.create(botInput("Other"));
    expect(
      (await first.app.request(`/files/${other.id}/${image.id}`)).status,
    ).toBe(404);
    const text = await first.client.files.upload({
      botId,
      file: new File(["<svg></svg>"], "image.png", { type: "image/png" }),
    });
    expect(text.mimeType).toBe("application/octet-stream");
    expect((await first.app.request(`/files/${botId}/${text.id}`)).status).toBe(
      404,
    );
    const { mimeType: _mimeType, ...metadata } = image;
    await writeFile(
      join(
        first.files.root,
        String(botId),
        "artifacts",
        image.id,
        "metadata.json",
      ),
      JSON.stringify(metadata),
    );
  } finally {
    await first.harness.close(context);
  }
  const second = await open();
  try {
    const preview = await second.app.request(`/files/${botId}/${image.id}`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("Content-Type")).toBe("image/png");
    expect(Buffer.from(await preview.arrayBuffer())).toEqual(bytes);
    expect(
      (await second.client.files.download({ botId, id: image.id })).type,
    ).toBe("image/png");
  } finally {
    await second.harness.close(context);
  }
});

test("uploaded text becomes a real edited deliverable with durable downloads and Bot ownership", async () => {
  const { open, faux } = await setup();
  const first = await open();
  let fileId = "";
  let botId = first.conversation.id;
  let delivered = "";
  const text = `Source ${crypto.randomUUID()}`;
  try {
    const upload = await first.client.files.upload({
      botId,
      file: new File([text], "资料.txt"),
    });
    expect(
      await first.client.files.upload({
        botId,
        file: new File([text], "资料.txt"),
      }),
    ).toEqual(upload);
    expect(
      (await first.client.files.download({ botId, id: upload.id })).name,
    ).toBe("资料.txt");
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("read", { path: upload.path })], {
        stopReason: "toolUse",
      }),
      async (input) => {
        const read = input.messages.at(-1);
        expect(read?.role).toBe("toolResult");
        expect(
          messageText(read as Parameters<typeof messageText>[0]),
        ).toContain(text);
        return fauxAssistantMessage(
          [
            fauxToolCall("write", {
              path: "reports/report.md",
              content: `# Draft\n${text}`,
            }),
          ],
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage(
        [
          fauxToolCall("edit", {
            path: "reports/report.md",
            edits: [{ oldText: "# Draft", newText: "# Report" }],
          }),
          fauxToolCall("attach_file", { path: "reports/report.md" }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Report ready"),
    ]);
    const send = {
      botId,
      text: "Build a report",
      attachments: [upload.id],
      requestId: crypto.randomUUID(),
    };
    expect(await first.client.send(send)).toEqual(
      await first.client.send(send),
    );
    await first.conversation.waitForIdle(context);
    const view = await first.client.get({ botId });
    expect(view.messages.filter((item) => item.role === "user")).toHaveLength(
      1,
    );
    expect(view.messages[0]).toMatchObject({
      attachments: [upload],
      content: [{ type: "text", text: "Build a report" }],
    });
    const results = view.messages.filter((item) => item.role === "toolResult");
    expect(results.map((item) => [item.toolName, item.isError])).toEqual([
      ["read", false],
      ["write", false],
      ["edit", false],
      ["attach_file", false],
    ]);
    const attachment = results.at(-1)?.attachments?.[0];
    expect(attachment?.name).toBe("report.md");
    fileId = attachment?.id ?? "";
    delivered = await (
      await first.client.files.download({ botId, id: fileId })
    ).text();
    expect(delivered).toBe(`# Report\n${text}`);
    const workspace = await first.files.workspace(botId);
    await workspace.writeFile("reports/report.md", "changed", context);
    expect(
      await (await first.client.files.download({ botId, id: fileId })).text(),
    ).toBe(delivered);
    const other = await first.client.bots.create(botInput("Other"));
    await expect(
      first.client.files.download({ botId: other.id, id: fileId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      first.client.send({
        botId: other.id,
        text: "Read it",
        attachments: [upload.id],
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  } finally {
    await first.harness.close(context);
  }
  const second = await open();
  try {
    botId = second.conversation.id;
    expect(
      await (await second.client.files.download({ botId, id: fileId })).text(),
    ).toBe(delivered);
    expect(
      (await second.client.get({ botId })).messages.some((item) =>
        item.attachments?.some((file) => file.id === fileId),
      ),
    ).toBe(true);
  } finally {
    await second.harness.close(context);
  }
});

test("file routes reject invalid targets, oversized uploads, and empty submissions", async () => {
  const { open, faux } = await setup();
  const runtime = await open();
  const botId = runtime.conversation.id;
  try {
    await expect(
      runtime.client.files.upload({
        botId: 999999,
        file: new File(["a"], "a.txt"),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      runtime.client.files.upload({
        botId,
        file: new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.txt"),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      runtime.client.send({ botId, text: "", requestId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const file = await runtime.client.files.upload({
      botId,
      file: new File(["attached"], "a.txt"),
    });
    faux.setResponses([fauxAssistantMessage("Received file")]);
    await runtime.client.send({
      botId,
      text: "",
      attachments: [file.id],
      requestId: crypto.randomUUID(),
    });
    await runtime.conversation.waitForIdle(context);
    expect(
      (await runtime.client.get({ botId })).messages[0]?.attachments,
    ).toEqual([file]);
  } finally {
    await runtime.harness.close(context);
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
    ).rejects.toMatchObject({ code: "CONFLICT" });
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
