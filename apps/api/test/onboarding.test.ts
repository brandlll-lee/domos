import { mkdtemp, rm } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { openAgent } from "@domos/agent";
import { openChat } from "@domos/agent/chat";
import { Computer } from "@domos/agent/computer";
import { parseConfig } from "@domos/agent/config";
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
import { expect, onTestFinished, test, vi } from "vitest";
import { createApp } from "../src/app.ts";
import type { AppRouter } from "../src/router.ts";

const context = BACKGROUND_CONTEXT;
const model = { provider: "faux", modelId: "faux-1" };

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "domos-onboarding-"));
  const config = parseConfig(
    { dataDir: directory },
    join(directory, "config.json"),
  );
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  let runtime = await openChat(context, config, { models });
  onTestFinished(async () => {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  });
  const client = () => {
    const app = createApp(
      runtime.bots,
      models,
      runtime.files,
      runtime.work,
      runtime.computer,
    );
    return createORPCClient<RouterClient<AppRouter>>(
      new RPCLink({
        url: "http://localhost/rpc",
        fetch: async (request, init) => app.fetch(new Request(request, init)),
      }),
    );
  };
  return {
    get runtime() {
      return runtime;
    },
    faux,
    client: client(),
    async reopen() {
      await runtime.close();
      runtime = await openChat(context, config, { models });
      return client();
    },
  };
}

test("Bot creation needs only a name and model setup preserves an empty transcript", async () => {
  const { client } = await fixture();
  const input = { name: "Writer", requestId: crypto.randomUUID() };
  const bot = await client.bots.create(input);
  expect(await client.bots.create(input)).toEqual(bot);
  expect((await client.get({ botId: bot.id })).model).toBeNull();
  expect((await client.computer.get({ botId: bot.id })).computer).toBeNull();
  await expect(
    client.send({
      botId: bot.id,
      text: "Keep this draft",
      requestId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect((await client.get({ botId: bot.id })).messages).toEqual([]);
  await client.models.select({ botId: bot.id, ...model });
  expect((await client.get({ botId: bot.id })).messages).toEqual([]);
});

test("chat works before computer authorization and Pi rejects computer tools", async () => {
  const state = await fixture();
  const { client, runtime, faux } = state;
  const botId = runtime.conversation.id;
  await client.models.select({ botId, ...model });
  const tools = (await runtime.conversation.agent(context)).tools.map(
    (tool) => tool.name,
  );
  expect(tools).not.toEqual(
    expect.arrayContaining([
      "write",
      "read",
      "edit",
      "attach_file",
      "bash",
      "powershell",
    ]),
  );
  for (const name of [
    "write",
    "read",
    "edit",
    "attach_file",
    "bash",
    "powershell",
  ])
    expect(tools).not.toContain(name);
  await expect(runtime.files.workspace(botId)).rejects.toThrow("分配");
  await expect(
    client.files.upload({ botId, file: new File(["data"], "input.txt") }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  faux.setResponses([
    async (input) => {
      const prompt = input.messages
        .filter((item) => item.role === "system")
        .flatMap((item) => Object.values(item.sections ?? {}))
        .join("\n");
      expect(prompt).toContain("no assigned computer");
      return fauxAssistantMessage(
        [fauxToolCall("write", { path: "denied.txt", content: "denied" })],
        { stopReason: "toolUse" },
      );
    },
    fauxAssistantMessage("Chat is available"),
  ]);
  const submission = await runtime.conversation.submit(
    { type: "input", content: "Chat" },
    context,
  );
  expect((await submission.wait(context)).status).toBe("done");
  expect((await client.get({ botId })).messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ role: "toolResult", toolStatus: "failed" }),
      expect.objectContaining({
        role: "assistant",
        content: expect.arrayContaining([
          expect.objectContaining({ text: "Chat is available" }),
        ]),
      }),
    ]),
  );
});

test("authorized computers support shared Bots, file round trips, defaults and restart", async () => {
  const state = await fixture();
  let { client } = state;
  const botId = state.runtime.conversation.id;
  const input = {
    botId,
    computerId: "process",
    revision: 0,
    requestId: crypto.randomUUID(),
  };
  await expect(client.computer.assign(input)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  await client.computer.authorize({ id: "process", authorized: true });
  await client.computer.assign(input);
  expect((await client.computer.assign(input)).revision).toBe(1);
  await expect(
    client.computer.assign({
      ...input,
      computerId: null,
      requestId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const tools = (await state.runtime.conversation.agent(context)).tools.map(
    (tool) => tool.name,
  );
  expect(tools).toContain(platform() === "win32" ? "powershell" : "bash");
  expect(tools).not.toContain(platform() === "win32" ? "bash" : "powershell");
  await client.computer.default({ id: "process" });
  const bot = await client.bots.create({
    name: "Shared",
    requestId: crypto.randomUUID(),
  });
  expect((await client.computer.get({ botId: bot.id })).computerId).toBe(
    "process",
  );
  const first = await state.runtime.files.workspace(botId);
  const second = await state.runtime.files.workspace(bot.id);
  expect(first.cwd).not.toBe(second.cwd);
  const file = await client.files.upload({
    botId,
    file: new File(["source"], "report.txt"),
  });
  await first.writeFile(
    await first.path("result.txt"),
    new TextEncoder().encode("processed"),
    context,
  );
  const result = await state.runtime.files.publish(
    botId,
    "result.txt",
    context,
  );
  expect(
    await (await client.files.download({ botId, id: result.id })).text(),
  ).toBe("processed");
  client = await state.reopen();
  expect((await client.computer.get({ botId })).computer).toMatchObject({
    authorized: true,
    capabilities: { files: true },
  });
  expect((await client.computer.get({ botId: bot.id })).computerId).toBe(
    "process",
  );
  expect(
    await (await client.files.download({ botId, id: file.id })).text(),
  ).toBe("source");
  await client.computer.authorize({ id: "process", authorized: false });
  expect((await client.computer.list()).defaultId).toBeNull();
  await expect(state.runtime.files.workspace(botId)).rejects.toThrow("撤销");
  expect(
    (await state.runtime.conversation.agent(context)).tools.map(
      (tool) => tool.name,
    ),
  ).not.toContain("write");
  expect(
    await (await client.files.download({ botId, id: result.id })).text(),
  ).toBe("processed");
});

test("binding and authorization changes reject active work", async () => {
  const { runtime, client, faux } = await fixture();
  const botId = runtime.conversation.id;
  await client.models.select({ botId, ...model });
  await client.computer.authorize({ id: "process", authorized: true });
  await client.computer.assign({
    botId,
    computerId: "process",
    revision: 0,
    requestId: crypto.randomUUID(),
  });
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  faux.setResponses([
    async () => {
      entered.resolve();
      await release.promise;
      return fauxAssistantMessage("Done");
    },
  ]);
  const submission = await runtime.conversation.submit(
    { type: "input", content: "Work" },
    context,
  );
  try {
    await entered.promise;
    await expect(
      client.computer.assign({
        botId,
        computerId: null,
        revision: 1,
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      client.computer.authorize({ id: "process", authorized: false }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await client.computer.get({ botId })).computerId).toBe("process");
  } finally {
    release.resolve();
    await submission.wait(context);
  }
  await client.computer.assign({
    botId,
    computerId: null,
    revision: 1,
    requestId: crypto.randomUUID(),
  });
  expect((await client.computer.get({ botId })).computer).toBeNull();
});

test("file transfers hold the binding and detached attachments require their computer", async () => {
  const { runtime, client } = await fixture();
  const botId = runtime.conversation.id;
  await client.models.select({ botId, ...model });
  await client.computer.authorize({ id: "process", authorized: true });
  await client.computer.assign({
    botId,
    computerId: "process",
    revision: 0,
    requestId: crypto.randomUUID(),
  });
  const entered = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const transfer = runtime.computer.transfer(
    botId,
    async () => {
      entered.resolve();
      await released.promise;
    },
    context,
  );
  try {
    await entered.promise;
    await expect(
      client.computer.assign({
        botId,
        computerId: null,
        revision: 1,
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  } finally {
    released.resolve();
    await transfer;
  }
  const file = await client.files.upload({
    botId,
    file: new File(["data"], "input.txt"),
  });
  expect(file.computerId).toBe("process");
  await client.computer.assign({
    botId,
    computerId: null,
    revision: 1,
    requestId: crypto.randomUUID(),
  });
  await expect(
    client.send({
      botId,
      text: "Process",
      attachments: [file.id],
      requestId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect((await client.get({ botId })).messages).toEqual([]);
});

test("unavailable assigned computers fail scheduled work and retain their target", async () => {
  const inspect = Computer.prototype.status;
  const spy = vi
    .spyOn(Computer.prototype, "status")
    .mockImplementation(async function (this: Computer) {
      if (this.config.computer.kind === "process") return inspect.call(this);
      return {
        id: this.config.computer.id,
        kind: "docker",
        deployment: "native",
        state: "stopped",
        os: "linux",
        arch: "x64",
        directory: "/home/domos",
        boundary: "sandbox",
        network: "none",
        error: null,
      };
    });
  onTestFinished(() => spy.mockRestore());
  const { runtime, client } = await fixture();
  const botId = runtime.conversation.id;
  await client.models.select({ botId, ...model });
  const input = {
    name: "Isolated",
    config: {
      kind: "docker" as const,
      id: "work",
      image: "domos-workspace:1.2.0",
      volume: "work-volume",
      network: "none" as const,
      cpus: 2,
      memoryMiB: 1024,
      pids: 256,
      timeoutSeconds: 120,
    },
  };
  await client.computer.add(input);
  expect((await client.computer.add(input)).items).toHaveLength(2);
  await client.computer.assign({
    botId,
    computerId: "work",
    revision: 0,
    requestId: crypto.randomUUID(),
  });
  const other = await client.bots.create({
    name: "Other",
    computerId: null,
    requestId: crypto.randomUUID(),
  });
  expect((await client.computer.get({ botId: other.id })).computer).toBeNull();
  const routine = await runtime.work.routines.save(
    botId,
    {
      id: crypto.randomUUID(),
      title: "Report",
      instructions: "Process files",
      skillIds: [],
      schedule: { type: "cron", expression: "0 9 * * *", timeZone: "UTC" },
      revision: 0,
      requestId: crypto.randomUUID(),
    },
    context,
  );
  const task = await runtime.work.routines.test(
    botId,
    routine.id,
    crypto.randomUUID(),
    context,
  );
  await runtime.harness.waitForTask(task, context);
  expect(
    (await runtime.work.routines.list(botId, context)).runs[0],
  ).toMatchObject({
    status: "failed",
    submissionId: null,
    error: expect.stringContaining("工作电脑不可用"),
  });
  expect((await client.computer.get({ botId })).computerId).toBe("work");
  expect((await client.get({ botId })).messages).toEqual([]);
});

test("migration keeps existing Bot targets and grants while new Bots start unassigned", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-migration-"));
  const config = parseConfig(
    { dataDir: directory, model },
    join(directory, "config.json"),
  );
  const models = createModels();
  models.setProvider(fauxProvider().provider);
  await new Computer(config).bind();
  const legacy = await openAgent(
    join(directory, "agent.sqlite"),
    { models, registry: createRegistry() },
    { model, instructions: "Preserve this role" },
    context,
  );
  const existing = await legacy.bots.create(
    { name: "Existing", model, requestId: crypto.randomUUID() },
    context,
  );
  const attachment = await legacy.files.upload(
    existing.id,
    "existing.txt",
    new TextEncoder().encode("Existing draft"),
  );
  await legacy.harness.close(context);
  let runtime = await openChat(context, config, { models });
  try {
    expect(
      (await runtime.computer.binding(existing.id, context)).computer,
    ).toMatchObject({ id: "process", authorized: true });
    expect(
      (await runtime.bots.profile(runtime.conversation.id, context))
        .instructions,
    ).toBe("Preserve this role");
    const bot = await runtime.bots.create(
      { name: "New", requestId: crypto.randomUUID() },
      context,
    );
    expect(
      (await runtime.computer.binding(bot.id, context)).computerId,
    ).toBeNull();
    await runtime.files.verify(existing.id, [attachment], context);
    await runtime.close();
    await rm(join(directory, "computer.json"));
    runtime = await openChat(context, config, { models });
    await runtime.files.verify(existing.id, [attachment], context);
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});
