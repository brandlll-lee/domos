import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { expect, onTestFinished, test } from "vitest";
import type { ChatView } from "../src/chat-view.ts";
import { Computer } from "../src/computer/index.ts";
import { EngineDoc, EngineMessage } from "../src/harness/state.ts";
import type { ChatMessage } from "../src/messages.ts";
import { parseConfig } from "../src/runtime/config.ts";
import { Runtime } from "../src/runtime/index.ts";
import { acquireDataLease } from "../src/runtime/lease.ts";
import { runtimeFixture } from "./fixtures/runtime.ts";

const model = { provider: "faux", modelId: "faux-1" };

test("history keeps the saved record when its draft snapshot overlaps", async () => {
  const { harness, conversation } = await runtimeFixture();
  const message = {
    id: "reply",
    role: "assistant",
    content: [],
    stopped: false,
  } satisfies ChatMessage;
  await harness.commit(async (tx) => {
    (await tx.doc(EngineDoc, conversation.id)).drafts = [message];
    await tx.appendEntry(conversation.id, {
      kind: EngineMessage,
      data: message,
    });
  }, BACKGROUND_CONTEXT);
  const view = await Runtime.prototype.view.call(
    { harness } as unknown as Runtime,
    conversation.id,
    BACKGROUND_CONTEXT,
  );
  expect(view.messages.filter((item) => item.id === "reply")).toHaveLength(1);
  expect(
    view.messages.find((item) => item.id === "reply")?.cursor,
  ).toBeDefined();
});

test("incremental history replaces completed drafts and retains paged records", async () => {
  const message = (id: string, cursor?: string) => ({
    id,
    cursor,
    role: "assistant" as const,
    content: [],
    stopped: false,
  });
  const previous: ChatView = {
    id: 1,
    model: null,
    instructions: "",
    draft: null,
    activeTurnId: null,
    busy: false,
    failed: false,
    tools: [],
    messages: [message("old", "1:0"), message("draft")],
  };
  const next = { ...previous, messages: [message("saved", "2:0")] };
  const source = {
    async *watch() {
      yield previous;
      yield next;
    },
  } as unknown as Runtime;
  const events = [];
  for await (const event of Runtime.prototype.updates.call(
    source,
    1,
    BACKGROUND_CONTEXT,
  ))
    events.push(event);
  expect(events[1]).toMatchObject({
    type: "update",
    messages: [message("saved", "2:0")],
    removed: ["draft"],
  });
});
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "domos-runtime-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("configuration resolves paths at its file, validates boundaries, and applies explicit overrides", () => {
  const filename = join(tmpdir(), "config", "domos.json");
  const input = {
    model,
    dataDir: "state",
    computer: {
      kind: "docker",
      id: "team",
      image: "domos-workspace:1.2.0",
      volume: "team-work",
      ssh: {
        host: "work.example",
        knownHostsFile: "keys/known_hosts",
        identityFile: "keys/id_ed25519",
        hostKeyAlias: "team",
      },
    },
  };
  const config = parseConfig(input, filename, {
    port: "5001",
    dataDir: "override",
  });
  expect(config.dataDir).toBe(join(tmpdir(), "config", "override"));
  expect(config.port).toBe(5001);
  expect(config.host).toBe("127.0.0.1");
  expect(config.computer).toMatchObject({
    kind: "docker",
    network: "none",
    ssh: { knownHostsFile: join(tmpdir(), "config", "keys", "known_hosts") },
  });
  expect(() =>
    parseConfig(
      { ...input, computer: { ...input.computer, volume: "../escape" } },
      filename,
    ),
  ).toThrow();
  expect(() =>
    parseConfig(
      { ...input, computer: { ...input.computer, network: "host" } },
      filename,
    ),
  ).toThrow();
  expect(() =>
    parseConfig({ ...input, secret: "rejected-input" }, filename),
  ).toThrow();
  expect(() => parseConfig(input, filename, { port: "invalid" })).toThrow();
  expect(parseConfig({ model }, filename).computer).toEqual({
    kind: "process",
  });
});

test("a data directory accepts one owner and releases it on close", async () => {
  const root = await directory();
  const release = await acquireDataLease(root);
  try {
    await expect(acquireDataLease(root)).rejects.toThrow("运行实例");
  } finally {
    await release();
  }
  await (await acquireDataLease(root))();
});

test("the operating system releases a crashed owner and excludes a live process", async () => {
  const root = await directory();
  const worker = fork(
    fileURLToPath(new URL("fixtures/lease-worker.ts", import.meta.url)),
    [root],
    { silent: true, execArgv: [] },
  );
  worker.stderr?.resume();
  worker.stdout?.resume();
  await Promise.race([
    once(worker, "message"),
    once(worker, "exit").then(() => {
      throw new Error("Lease worker exited");
    }),
  ]);
  await expect(acquireDataLease(root)).rejects.toThrow("其他运行实例");
  const exit = once(worker, "exit");
  worker.kill("SIGKILL");
  await exit;
  await (await acquireDataLease(root))();
});

test("process and application boundaries retain existing workspaces and refuse silent target changes", async () => {
  const dataDir = await directory();
  const config = parseConfig({ model, dataDir }, join(dataDir, "config.json"));
  const computer = new Computer(config);
  await computer.bind();
  const env = await computer.workspace(1, BACKGROUND_CONTEXT);
  expect(env.cwd).toBe(join(dataDir, "agent.sqlite.files", "1", "workspace"));
  expect(await computer.status()).toMatchObject({
    boundary: "host",
    state: "running",
  });
  const container = new Computer({ ...config, deployment: "container" });
  expect(await container.status()).toMatchObject({ boundary: "application" });
  await expect(container.bind()).rejects.toThrow("执行目标已改变");
  await computer.close(BACKGROUND_CONTEXT);
});
