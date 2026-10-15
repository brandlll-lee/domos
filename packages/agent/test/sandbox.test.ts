import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { expect, onTestFinished, test, vi } from "vitest";
import {
  DockerComputer,
  hostCommand,
  quoteArgument,
} from "../src/computer/docker.ts";
import { Computer } from "../src/computer/index.ts";
import { parseConfig } from "../src/runtime/config.ts";

const context = BACKGROUND_CONTEXT;
async function setup() {
  const dataDir = await mkdtemp(join(tmpdir(), "domos-sandbox-"));
  onTestFinished(async () => {
    vi.restoreAllMocks();
    await rm(dataDir, { recursive: true, force: true });
  });
  const config = parseConfig(
    {
      model: { provider: "faux", modelId: "faux-1" },
      dataDir,
      computer: {
        kind: "docker",
        id: "test",
        image: "domos-workspace:1.2.0",
        volume: "test-work",
      },
    },
    join(dataDir, "config.json"),
  );
  return { computer: new Computer(config), config, dataDir };
}

test("an unavailable work computer reports failure and never creates host workspaces", async () => {
  const { computer, dataDir } = await setup();
  const inspect = vi
    .spyOn(DockerComputer.prototype, "inspect")
    .mockRejectedValue(new Error("Control connection lost"));
  expect(await computer.status()).toMatchObject({
    state: "unavailable",
    boundary: "sandbox",
    os: null,
  });
  await expect(computer.workspace(1, context)).rejects.toThrow(
    "Control connection lost",
  );
  expect(inspect).toHaveBeenCalledTimes(2);
  expect(await readdir(dataDir)).toEqual([]);
  await computer.close(context);
});

test("lifecycle changes serialize, block new execution, and check active work before mutation", async () => {
  const { computer } = await setup();
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const start = vi
    .spyOn(DockerComputer.prototype, "start")
    .mockImplementation(async () => {
      entered.resolve();
      await gate.promise;
    });
  const stop = vi.spyOn(DockerComputer.prototype, "stop").mockResolvedValue();
  vi.spyOn(DockerComputer.prototype, "inspect").mockResolvedValue("running");
  const starting = computer.manage("start", context, async () => {});
  await entered.promise;
  const stopping = computer.manage("stop", context, async () => {});
  await expect(computer.workspace(2, context)).rejects.toThrow("切换运行状态");
  expect(stop).not.toHaveBeenCalled();
  gate.resolve();
  await Promise.all([starting, stopping]);
  expect(start).toHaveBeenCalledTimes(1);
  expect(stop).toHaveBeenCalledTimes(1);
  await expect(
    computer.manage("stop", context, async () => {
      throw new Error("Bot busy");
    }),
  ).rejects.toThrow("Bot busy");
  expect(stop).toHaveBeenCalledTimes(1);
});

test("a control request with an uncertain outcome is reported once", async () => {
  const { computer } = await setup();
  const start = vi
    .spyOn(DockerComputer.prototype, "start")
    .mockRejectedValue(new Error("Unknown outcome"));
  await expect(
    computer.manage("start", context, async () => {}),
  ).rejects.toThrow("Unknown outcome");
  expect(start).toHaveBeenCalledTimes(1);
});

test("SSH transport uses strict host keys and preserves each remote argument", async () => {
  const { config } = await setup();
  if (config.computer.kind !== "docker")
    throw new Error("Docker config required");
  const value = "words ' with $() ` and ;";
  const command = hostCommand(
    {
      ...config.computer,
      ssh: {
        host: "work.example",
        hostKeyAlias: "work",
        knownHostsFile: join(tmpdir(), "known_hosts"),
      },
    },
    ["docker", "exec", value],
  );
  expect(command[0]).toBe("ssh");
  expect(command).toContain("StrictHostKeyChecking=yes");
  expect(command.at(-1)).toBe(
    ["docker", "exec", value].map(quoteArgument).join(" "),
  );
});
