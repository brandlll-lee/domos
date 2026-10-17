import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openChat } from "@domos/agent/chat";
import { Computer, type ComputerStatus } from "@domos/agent/computer";
import { parseConfig } from "@domos/agent/config";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { expect, onTestFinished, test, vi } from "vitest";

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

test("shared preparation persists and new Bots choose their own environment", async () => {
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
  expect((await computer.binding(second.id, context)).computerId).toBe(null);
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

test("container services report their boundary and prepare controller computers", async () => {
  const { runtime } = await fixture({
    deployment: "container",
    workComputer: {
      kind: "controller",
      id: "template",
      endpoint: "http://controller:4311",
      credentialFile: "controller-token",
      network: "none",
    },
  });
  const { computer, conversation } = runtime;
  expect(await computer.preparation.state(context)).toEqual({
    deployment: "container",
    canIsolate: true,
  });
  const native = await computer.preparation.configure(
    {
      mode: "process",
      botId: conversation.id,
      revision: 0,
      requestId: crypto.randomUUID(),
    },
    context,
  );
  expect(native.computer).toMatchObject({
    name: "服务所在容器",
    boundary: "application",
  });
  const isolated = await computer.preparation.configure(
    {
      mode: "dedicated",
      botId: conversation.id,
      revision: native.revision,
      requestId: crypto.randomUUID(),
    },
    context,
  );
  expect(isolated.computer?.kind).toBe("controller");
  expect(isolated.computerId).not.toBe("template");
});
