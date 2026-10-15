import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { expect, onTestFinished, test } from "vitest";
import { Computer } from "../src/computer/index.ts";
import { parseConfig } from "../src/runtime/config.ts";
import { acquireDataLease } from "../src/runtime/lease.ts";

const model = { provider: "faux", modelId: "faux-1" };
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
