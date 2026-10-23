import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAgent } from "@domos/agent";
import { Computers } from "@domos/agent/computer/catalog";
import { parseConfig } from "@domos/agent/config";
import { Files } from "@domos/agent/files";
import { messageText } from "@domos/agent/messages";
import { chatTranscript } from "@domos/agent/transcript";
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
    const computer = new Computers(
      parseConfig({ model: agent.model, dataDir: directory }, database),
    );
    await computer.initialize(runtime.harness, runtime.bots, context, true);
    const app = createApp(
      runtime.bots,
      models,
      runtime.files,
      runtime.work,
      computer,
    );
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

test("welcome dismissal is shared, idempotent and survives a service restart", async () => {
  const { open } = await setup();
  const first = await open();
  const botId = first.conversation.id;
  const events = await first.client.bots.subscribe();
  try {
    expect((await events.next()).value?.items[0]).toMatchObject({
      id: botId,
      welcomeComplete: false,
    });
    const other = await first.client.bots.create(botInput("Second"));
    await first.client.bots.completeWelcome({ botId });
    let update = await events.next();
    while (!update.done && !update.value.items[0]?.welcomeComplete)
      update = await events.next();
    expect(update.value?.items[0]?.welcomeComplete).toBe(true);
    await first.client.bots.completeWelcome({ botId });
    expect(await first.client.bots.list()).toEqual([
      expect.objectContaining({ id: botId, welcomeComplete: true }),
      expect.objectContaining({ id: other.id, welcomeComplete: false }),
    ]);
    await expect(
      first.client.bots.completeWelcome({ botId: Number.MAX_SAFE_INTEGER }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  } finally {
    await events.return();
    await first.harness.close(context);
  }
  const second = await open();
  try {
    expect((await second.client.bots.list())[0]?.welcomeComplete).toBe(true);
  } finally {
    await second.harness.close(context);
  }
});

test("welcome completes only after a message is accepted", async () => {
  const { open, faux } = await setup();
  const runtime = await open();
  const botId = runtime.conversation.id;
  try {
    await expect(
      runtime.client.send({ botId, text: "", requestId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await runtime.client.bots.list())[0]?.welcomeComplete).toBe(false);
    faux.setResponses([fauxAssistantMessage("Ready")]);
    const input = { botId, text: "Hello", requestId: crypto.randomUUID() };
    const receipt = await runtime.client.send(input);
    expect((await runtime.client.bots.list())[0]?.welcomeComplete).toBe(true);
    expect(await runtime.client.send(input)).toEqual(receipt);
    await runtime.conversation.waitForIdle(context);
  } finally {
    await runtime.harness.close(context);
  }
});

test("Bot work routes enforce ownership, revisions, validation and live updates", async () => {
  const { open } = await setup();
  const runtime = await open();
  let events:
    | AsyncGenerator<Awaited<ReturnType<typeof runtime.client.work.get>>>
    | undefined;
  try {
    const botId = runtime.conversation.id;
    const other = await runtime.client.bots.create(botInput("Second"));
    const profile = await runtime.client.work.profile({ botId });
    const updated = await runtime.client.work.update({
      botId,
      name: "Archivist",
      avatar: profile.avatar,
      instructions: "Organize reports",
      revision: profile.revision,
      requestId: crypto.randomUUID(),
    });
    expect(updated.name).toBe("Archivist");
    await expect(
      runtime.client.work.update({
        botId,
        name: "Stale",
        avatar: profile.avatar,
        instructions: "Stale",
        revision: profile.revision,
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    events = await runtime.client.work.subscribe({ botId });
    expect((await events.next()).value?.memory).toEqual([]);
    const pending = events.next();
    const input = {
      botId,
      id: crypto.randomUUID(),
      text: "Use concise reports",
      shared: false,
      revision: 0,
      requestId: crypto.randomUUID(),
    };
    const memory = await runtime.client.work.memory.save(input);
    expect((await pending).value?.memory[0]?.text).toBe(input.text);
    expect(await runtime.client.work.memory.save(input)).toEqual(memory);
    expect((await runtime.client.work.get({ botId: other.id })).memory).toEqual(
      [],
    );
    await expect(
      runtime.client.work.memory.save({
        ...input,
        botId: other.id,
        revision: memory.revision,
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      runtime.client.work.skills.save({
        botId,
        id: crypto.randomUUID(),
        content: "Invalid SKILL.md",
        revision: 0,
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const routine = await runtime.client.work.routines.save({
      botId,
      id: crypto.randomUUID(),
      title: "Report",
      instructions: "Prepare a report",
      schedule: {
        type: "cron",
        expression: "0 9 * * *",
        timeZone: "Asia/Shanghai",
      },
      skillIds: [],
      revision: 0,
      requestId: crypto.randomUUID(),
    });
    expect(routine.enabled).toBe(false);
    await expect(
      runtime.client.work.routines.enable({
        botId: other.id,
        id: routine.id,
        enabled: true,
        revision: routine.revision,
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      runtime.client.work.get({ botId: Number.MAX_SAFE_INTEGER }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      runtime.client.work.routines.save({
        ...routine,
        schedule: { type: "cron", expression: "invalid", timeZone: "UTC" },
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await runtime.client.work.memory.delete({
      botId,
      id: memory.id,
      revision: memory.revision,
    });
    await runtime.client.work.routines.delete({
      botId,
      id: routine.id,
      revision: routine.revision,
    });
    expect((await runtime.client.work.get({ botId })).routines.items).toEqual(
      [],
    );
    expect((await runtime.client.work.get({ botId })).memory).toEqual([]);
  } finally {
    await events?.return(undefined as never);
    await runtime.harness.close(context);
  }
});

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
        avatar: expect.any(String),
        createdAt: expect.any(Number),
        welcomeComplete: false,
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
        avatar: expect.any(String),
        createdAt: expect.any(Number),
        welcomeComplete: false,
        busy: false,
        preview: "",
      },
      {
        ...bot,
        welcomeComplete: false,
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
    const uploadRequestId = crypto.randomUUID();
    const upload = await first.client.files.upload({
      requestId: uploadRequestId,
      botId,
      file: new File([text], "资料.txt"),
    });
    expect(
      await first.client.files.upload({
        requestId: uploadRequestId,
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
        const read = input.messages.findLast(
          (message) => message.role === "toolResult",
        );
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
      error: "回复失败。请检查模型配置、余额或网络。",
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

test("computer routes expose actual execution boundaries and validate Bot ownership", async () => {
  const { open } = await setup();
  const runtime = await open();
  const controller = new AbortController();
  try {
    const botId = runtime.conversation.id;
    expect(
      (await runtime.client.computer.get({ botId })).computer,
    ).toMatchObject({
      kind: "process",
      state: "running",
      boundary: "host",
    });
    const events = await runtime.client.bots.subscribe(undefined, {
      signal: controller.signal,
    });
    let update = await events.next();
    while (!update.done && !update.value.computers.length)
      update = await events.next();
    expect(update.value?.computers[0]).toMatchObject({ boundary: "host" });
    expect(update.value?.items).toHaveLength(1);
    controller.abort();
    await expect(
      runtime.client.computer.get({ botId: Number.MAX_SAFE_INTEGER }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      runtime.client.computer.manage({ id: "process", action: "stop" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  } finally {
    controller.abort();
    await runtime.harness.close(context);
  }
});

test("draft cleanup preserves sent snapshots and separates independent uploads", async () => {
  const { open, faux } = await setup();
  const runtime = await open();
  const botId = runtime.conversation.id;
  try {
    const input = {
      botId,
      file: new File(["draft"], "draft.txt"),
      requestId: crypto.randomUUID(),
    };
    const first = await runtime.client.files.upload(input);
    expect(await runtime.client.files.upload(input)).toEqual(first);
    const second = await runtime.client.files.upload({
      ...input,
      requestId: crypto.randomUUID(),
    });
    expect(second.id).not.toBe(first.id);
    await runtime.client.files.discard({ botId, id: first.id });
    await expect(
      runtime.client.files.download({ botId, id: first.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      await runtime.client.files.download({ botId, id: second.id }),
    ).toBeInstanceOf(File);
    faux.setResponses([fauxAssistantMessage("Received")]);
    await runtime.client.send({
      botId,
      text: "Read this",
      attachments: [second.id],
      requestId: crypto.randomUUID(),
    });
    await runtime.conversation.waitForIdle(context);
    await runtime.client.files.discard({ botId, id: second.id });
    expect(
      await (
        await runtime.client.files.download({ botId, id: second.id })
      ).text(),
    ).toBe("draft");
    await runtime.client.files.discard({ botId, id: first.id });
  } finally {
    await runtime.harness.close(context);
  }
});

test("request skills and message references store authoritative snapshots across restart", async () => {
  const { open, faux } = await setup();
  const runtime = await open();
  const botId = runtime.conversation.id;
  let requestId = "";
  try {
    faux.setResponses([
      fauxAssistantMessage("Original source"),
      fauxAssistantMessage("Used references"),
    ]);
    await runtime.client.send({
      botId,
      text: "Source request",
      requestId: crypto.randomUUID(),
    });
    await runtime.conversation.waitForIdle(context);
    const source = (await runtime.client.get({ botId })).messages.find(
      (message) => message.role === "assistant",
    );
    const skill = await runtime.work.skills.save(
      {
        id: crypto.randomUUID(),
        content:
          "---\nname: report\ndescription: Write a report\n---\nUse the saved method.",
        revision: 0,
        requestId: crypto.randomUUID(),
      },
      context,
    );
    await runtime.work.skills.enable(
      botId,
      skill.id,
      true,
      skill.revision,
      crypto.randomUUID(),
      context,
    );
    const enabled = (await runtime.work.skills.list(context))[0];
    if (!enabled) throw new Error("Missing skill");
    const selection = { id: skill.id, revision: enabled.revision };
    await expect(
      runtime.client.send({
        botId,
        text: "Use this",
        skills: [{ ...selection, revision: 0 }],
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      runtime.client.send({
        botId,
        text: "Quote",
        context: [
          {
            id: crypto.randomUUID(),
            type: "message",
            messageId: "other-bot-message",
          },
        ],
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    requestId = crypto.randomUUID();
    const input = {
      botId,
      text: "Use these",
      skills: [selection],
      context: [
        {
          id: crypto.randomUUID(),
          type: "message" as const,
          messageId: source?.id ?? "",
        },
        { id: crypto.randomUUID(), type: "text" as const, text: "Quoted text" },
      ],
      requestId,
    };
    const receipt = await runtime.client.send(input);
    await runtime.conversation.waitForIdle(context);
    await runtime.work.skills.enable(
      botId,
      skill.id,
      false,
      enabled.revision,
      crypto.randomUUID(),
      context,
    );
    expect(await runtime.client.send(input)).toEqual(receipt);
    const sent = (await runtime.client.get({ botId })).messages.find(
      (message) => message.requestId === requestId,
    );
    expect(sent?.materials?.context[0]).toMatchObject({
      messageId: source?.id,
      text: "Original source",
      botId,
    });
    expect(sent?.materials?.skills[0]).toMatchObject({
      name: "report",
      revision: enabled.revision,
      content: skill.content,
    });
    expect((await runtime.work.skills.list(context))[0]?.enabledBots).toEqual(
      [],
    );
  } finally {
    await runtime.harness.close(context);
  }
  const reopened = await open();
  try {
    const sent = (await reopened.client.get({ botId })).messages.find(
      (message) => message.requestId === requestId,
    );
    expect(sent?.materials?.context).toHaveLength(2);
    expect(sent?.materials?.skills[0]?.name).toBe("report");
  } finally {
    await reopened.harness.close(context);
  }
});

test("attachment validation uses detected MIME and the selected model capability", async () => {
  const { open, models } = await setup();
  models.setProvider(
    fauxProvider({ models: [{ id: "text-only", input: ["text"] }] }).provider,
  );
  const runtime = await open();
  const botId = runtime.conversation.id;
  try {
    await expect(
      runtime.client.files.upload({
        botId,
        file: new File(
          [new Uint8Array([0x42, 0x4d, ...new Uint8Array(62)])],
          "photo.bmp",
        ),
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("photo.bmp"),
    });
    const { png } = await import(
      "../../../packages/agent/test/fixtures/png.ts"
    );
    const image = await runtime.client.files.upload({
      botId,
      file: new File([png(1, 1)], "source.bin"),
    });
    expect(image.mimeType).toBe("image/png");
    await runtime.client.models.select({
      botId,
      provider: "faux",
      modelId: "text-only",
    });
    await expect(
      runtime.client.send({
        botId,
        text: "Read this",
        attachments: [image.id],
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("source.bin"),
    });
    expect((await runtime.client.get({ botId })).messages).toEqual([]);
  } finally {
    await runtime.harness.close(context);
  }
});
