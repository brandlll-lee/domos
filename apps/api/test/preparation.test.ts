import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openChat } from "@domos/agent/chat";
import { Computer, type ComputerStatus } from "@domos/agent/computer";
import { parseConfig } from "@domos/agent/config";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { expect, onTestFinished, test, vi } from "vitest";
import { ComputersDoc } from "../../../packages/agent/src/computer/state.ts";

const context = BACKGROUND_CONTEXT;

async function fixture(overrides: Record<string, unknown> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "domos-prepare-"));
  const states = new Map<string, ComputerStatus["state"]>();
  const volumes = new Set<string>();
  const status = Computer.prototype.status;
  vi.spyOn(Computer.prototype, "status").mockImplementation(function (
    this: Computer,
  ) {
    if (this.config.computer.kind === "process") return status.call(this);
    return Promise.resolve({
      id: this.config.computer.id,
      kind: this.config.computer.kind,
      state: states.get(this.config.computer.id) ?? "missing",
      deployment: "native",
      directory: "/workspace",
      boundary: "sandbox",
      network: "none",
      error: null,
      os: "linux",
      arch: "x64",
    });
  });
  const start = vi
    .spyOn(Computer.prototype, "manage")
    .mockImplementation(async function (this: Computer, _action, _ctx, idle) {
      await idle();
      if (this.config.computer.kind === "docker")
        volumes.add(this.config.computer.volume);
      const id =
        this.config.computer.kind === "process"
          ? "process"
          : this.config.computer.id;
      states.set(id, "running");
      return this.status();
    });
  const config = parseConfig(
    {
      dataDir: directory,
      workComputer: {
        kind: "docker",
        id: "template",
        image: "fixture:1",
        volume: "template-work",
      },
      ...overrides,
    },
    join(directory, "config.json"),
  );
  let runtime = await openChat(context, config, { models: createModels() });
  onTestFinished(async () => {
    await runtime.close();
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    get runtime() {
      return runtime;
    },
    start,
    volumes,
    states,
    async reopen() {
      await runtime.close();
      runtime = await openChat(context, config, { models: createModels() });
    },
  };
}

test("new Bots use their owning computer without granting system access", async () => {
  const state = await fixture();
  const { bots, computer } = state.runtime;
  const first = await bots.create(
    { name: "Writer", requestId: crypto.randomUUID() },
    context,
  );
  expect(await computer.binding(first.id, context)).toMatchObject({
    computerId: "process",
    computer: { authorized: false },
  });
  await expect(computer.workspace(first.id, context)).rejects.toThrow("授权");
  await computer.authorize("process", true, context);
  const second = await bots.create(
    { name: "Reviewer", requestId: crypto.randomUUID() },
    context,
  );
  const workspace = await computer.workspace(first.id, context);
  expect((await computer.workspace(second.id, context)).cwd).not.toBe(
    workspace.cwd,
  );
  await state.reopen();
  expect((await state.runtime.computer.workspace(first.id, context)).cwd).toBe(
    workspace.cwd,
  );
});

test("project selection preserves personal files and uses the same directory after restart", async () => {
  const state = await fixture();
  const { computer, bots } = state.runtime;
  const node = await computer.node(context);
  const bot = await bots.create(
    { name: "Developer", requestId: crypto.randomUUID() },
    context,
  );
  await computer.authorize("process", true, context);
  const personal = (await computer.workspace(bot.id, context)).cwd;
  await writeFile(join(personal, "note.txt"), "personal");
  await mkdir(join(personal, "project"));
  const project = await realpath(join(personal, "project"));
  await writeFile(join(project, "source.txt"), "project");
  const input = {
    botId: bot.id,
    directory: project,
    revision: 0,
    requestId: crypto.randomUUID(),
  };
  const listing = await computer.directories(bot.id, personal, context);
  expect(listing.items).toEqual([
    { name: "project", path: join(personal, "project") },
  ]);
  await computer.directory(input, context);
  expect(await computer.directory(input, context)).toMatchObject({
    revision: 1,
    directory: project,
  });
  const worker = await computer.process(
    bot.id,
    [],
    async () => ({ content: [] }),
    context,
  );
  try {
    expect((await worker.ready).cwd).toBe(project);
    await expect(
      computer.directory(
        {
          ...input,
          directory: null,
          revision: 1,
          requestId: crypto.randomUUID(),
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  } finally {
    await worker.close();
  }

  expect((await computer.workspace(bot.id, context)).cwd).toBe(project);
  const file = await state.runtime.files.publish(bot.id, "source.txt", context);
  expect(
    await (await state.runtime.files.download(bot.id, file.id)).text(),
  ).toBe("project");
  await expect(
    computer.directory(
      {
        ...input,
        directory: join(project, "missing"),
        revision: 1,
        requestId: crypto.randomUUID(),
      },
      context,
    ),
  ).rejects.toThrow();
  expect((await computer.workspace(bot.id, context)).cwd).toBe(project);
  await state.reopen();
  expect(await state.runtime.computer.node(context)).toEqual(node);
  expect((await state.runtime.computer.workspace(bot.id, context)).cwd).toBe(
    project,
  );
  await state.runtime.computer.directory(
    { ...input, directory: null, revision: 1, requestId: crypto.randomUUID() },
    context,
  );
  expect((await state.runtime.computer.workspace(bot.id, context)).cwd).toBe(
    personal,
  );
  expect(await readFile(join(personal, "note.txt"), "utf8")).toBe("personal");
});

test.each([true, false])(
  "changing projects preserves source uploads with saved directory %s",
  async (savedDirectory) => {
    const state = await fixture();
    const { computer, files, conversation } = state.runtime;
    const botId = conversation.id;
    await computer.authorize("process", true, context);
    const personal = (await computer.workspace(botId, context)).cwd;
    const file = await files.upload(
      botId,
      "draft.txt",
      Buffer.from("original"),
    );
    if (!savedDirectory) {
      const { directory, ...metadata } = file;
      await writeFile(
        join(files.root, String(botId), "artifacts", file.id, "metadata.json"),
        JSON.stringify(metadata),
      );
    }
    const project = join(personal, "code");
    await mkdir(project);
    await computer.directory(
      {
        botId,
        directory: project,
        revision: 0,
        requestId: crypto.randomUUID(),
      },
      context,
    );
    const collision = join(project, file.path);
    await mkdir(dirname(collision), { recursive: true });
    await writeFile(collision, "project file");
    const input = await files.metadata(botId, file.id);
    await files.verify(botId, [input], context);
    expect(await readFile(input.path, "utf8")).toBe("original");
    await files.discard(botId, file.id);
    expect(await readFile(collision, "utf8")).toBe("project file");
    await expect(readFile(join(personal, file.path))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

test("shared preparation persists while new Bots use their owning computer", async () => {
  const state = await fixture();
  const { computer, conversation, bots } = state.runtime;
  const input = {
    mode: "shared" as const,
    botId: conversation.id,
    revision: 0,
    requestId: crypto.randomUUID(),
  };
  const [first, repeated] = await Promise.all([
    computer.preparation.configure(input, context),
    computer.preparation.configure(input, context),
  ]);
  expect(repeated).toEqual(first);
  expect(state.start).toHaveBeenCalledTimes(1);
  const second = await bots.create(
    { name: "Research", requestId: crypto.randomUUID() },
    context,
  );
  expect((await computer.binding(second.id, context)).computerId).toBe(
    "process",
  );
  const secondBinding = await computer.preparation.configure(
    {
      mode: "shared",
      botId: second.id,
      revision: 0,
      requestId: crypto.randomUUID(),
    },
    context,
  );
  expect(secondBinding.computerId).toBe(first.computerId);
  await state.reopen();
  expect(await state.runtime.computer.preparation.state(context)).toMatchObject(
    { deployment: "native", canIsolate: true },
  );
  expect(
    (await state.runtime.computer.binding(conversation.id, context)).computerId,
  ).toBe(first.computerId);
});

test("private preparation isolates volumes, refuses foreign bindings and retries failures", async () => {
  const state = await fixture();
  const { computer, conversation, bots } = state.runtime;
  const shared = await computer.preparation.configure(
    {
      mode: "shared",
      botId: conversation.id,
      revision: 0,
      requestId: crypto.randomUUID(),
    },
    context,
  );
  const input = {
    mode: "dedicated" as const,
    botId: conversation.id,
    revision: shared.revision,
    requestId: crypto.randomUUID(),
  };
  state.start.mockRejectedValueOnce(new Error("Preparation interrupted"));
  await expect(computer.preparation.configure(input, context)).rejects.toThrow(
    "Preparation interrupted",
  );
  expect((await computer.binding(conversation.id, context)).computerId).toBe(
    shared.computerId,
  );
  const failed = (await computer.list(context)).items.find(
    (item) => item.scope?.kind === "dedicated",
  );
  const ready = await computer.preparation.configure(input, context);
  expect(ready.computerId).toBe(failed?.id);
  expect(ready.computerId).not.toBe(shared.computerId);
  const second = await bots.create(
    { name: "Editor", requestId: crypto.randomUUID() },
    context,
  );
  await expect(
    computer.assign(
      second.id,
      {
        computerId: ready.computerId,
        revision: 0,
        requestId: crypto.randomUUID(),
      },
      context,
    ),
  ).rejects.toThrow("另一个 Bot");
  const secondPrivate = await computer.preparation.configure(
    {
      mode: "dedicated",
      botId: second.id,
      revision: 0,
      requestId: crypto.randomUUID(),
    },
    context,
  );
  const records = (await computer.list(context)).items.filter(
    (item) => item.scope?.kind === "dedicated",
  );
  expect(new Set(records.map((item) => item.id)).size).toBe(2);
  expect(secondPrivate.computerId).not.toBe(ready.computerId);
  await expect(computer.setDefault(ready.computerId, context)).rejects.toThrow(
    "共享电脑",
  );
  expect(state.volumes.size).toBe(3);
  if (!ready.computerId) throw new Error("Expected an assigned computer");
  state.states.set(ready.computerId, "stopped");
  await state.reopen();
  await state.runtime.computer.transfer(
    conversation.id,
    async () => {
      expect(
        (await state.runtime.computer.binding(conversation.id, context))
          .computer?.state,
      ).toBe("running");
    },
    context,
  );
  expect(
    (await state.runtime.computer.binding(conversation.id, context)).computer
      ?.state,
  ).toBe("running");
});

test("host choice grants access and stale switches leave the binding intact", async () => {
  const { runtime } = await fixture();
  const { computer, conversation } = runtime;
  expect((await computer.list(context)).items[0]?.authorized).toBe(false);
  const input = {
    mode: "process" as const,
    botId: conversation.id,
    revision: 0,
    requestId: crypto.randomUUID(),
  };
  const binding = await computer.preparation.configure(input, context);
  expect(binding.computer?.capabilities).toMatchObject({
    commands: true,
    files: true,
  });
  await expect(
    computer.preparation.configure(
      { ...input, requestId: crypto.randomUUID(), mode: "shared" },
      context,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await computer.binding(conversation.id, context)).computerId).toBe(
    "process",
  );
  const isolated = await computer.preparation.configure(
    {
      ...input,
      revision: binding.revision,
      requestId: crypto.randomUUID(),
      mode: "dedicated",
    },
    context,
  );
  expect(isolated.computer?.scope?.kind).toBe("dedicated");
  expect(isolated.computerId).not.toBe("process");
  const native = await computer.preparation.configure(
    { ...input, revision: isolated.revision, requestId: crypto.randomUUID() },
    context,
  );
  expect(native.computerId).toBe("process");
});

test("remote templates keep existing bindings while new environments stay on the owner", async () => {
  const remote = {
    kind: "controller" as const,
    id: "remote",
    endpoint: "http://controller:4311",
    credentialFile: "controller-token",
    network: "none" as const,
    timeoutSeconds: 120,
  };
  const state = await fixture({
    deployment: "container",
    workComputer: remote,
  });
  const { computer, conversation, harness } = state.runtime;
  expect(await computer.preparation.state(context)).toEqual({
    deployment: "container",
    canIsolate: false,
  });
  await expect(
    computer.add({ name: "Remote", config: remote }, context),
  ).rejects.toThrow("连接目标电脑");
  await expect(
    computer.preparation.configure(
      {
        botId: conversation.id,
        mode: "dedicated",
        revision: 0,
        requestId: crypto.randomUUID(),
      },
      context,
    ),
  ).rejects.toThrow("本地 Docker");
  await harness.commit(async (tx) => {
    const doc = await tx.doc(ComputersDoc);
    doc.items.push({
      id: remote.id,
      name: "Remote",
      config: remote,
      authorized: true,
    });
    doc.bindings[String(conversation.id)] = {
      computerId: remote.id,
      revision: 3,
      requestId: "old-binding",
    };
  }, context);
  await state.reopen();
  expect(
    await state.runtime.computer.binding(conversation.id, context),
  ).toMatchObject({ computerId: remote.id, revision: 3 });
  const bot = await state.runtime.bots.create(
    { name: "New", requestId: crypto.randomUUID() },
    context,
  );
  expect(
    (await state.runtime.computer.binding(bot.id, context)).computerId,
  ).toBe("process");
  await expect(
    state.runtime.computer.assign(
      bot.id,
      { computerId: remote.id, revision: 0, requestId: crypto.randomUUID() },
      context,
    ),
  ).rejects.toThrow("连接目标电脑");
});
