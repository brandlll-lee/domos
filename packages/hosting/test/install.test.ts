import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireDataLease } from "@domos/agent/lease";
import { expect, onTestFinished, test } from "vitest";
import {
  prepareInstallation,
  prepareLocalInstallation,
  type Release,
} from "../src/install.ts";
import { backupInstallation, restoreInstallation } from "../src/maintenance.ts";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "domos-install-test-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
const release: Release = {
  version: "test",
  workImage: "test-image:1",
  controllerEntry: "controller.ts",
  serverEntry: "server.ts",
  bridgeEntry: "bridge.ts",
  staticDir: "web",
};

test("local installation creates a loopback service and preserves existing configuration", async () => {
  const directory = await fixture();
  const first = await prepareLocalInstallation(directory, release);
  expect(first.config).toMatchObject({
    host: "127.0.0.1",
    computer: { kind: "process" },
    dataDir: join(directory, "data"),
  });
  expect(first.config.port).toBeGreaterThan(0);
  const config = { ...first.config, port: 34567 };
  await writeFile(first.configFile, JSON.stringify(config));
  expect((await prepareLocalInstallation(directory, release)).config).toEqual(
    config,
  );
});

test("installation checks Linux mode, preserves configuration and retries image setup", async () => {
  const directory = await fixture();
  const installation = join(directory, "host");
  const phases: string[] = [];
  let missingImage = true;
  const executed: string[][] = [];
  const run = async (_command: string, args: string[]) => {
    executed.push(args);
    if (args[0] === "info") return JSON.stringify("linux");
    if (args[0] === "image" && missingImage) throw new Error("Missing image");
    if (args[0] === "pull") missingImage = false;
    return "";
  };
  const first = await prepareInstallation(
    installation,
    release,
    (value) => phases.push(value.phase),
    undefined,
    run,
  );
  const token = await readFile(join(installation, "controller-token"), "utf8");
  const config = {
    ...(first.config as object),
    model: { provider: "test", modelId: "a" },
  };
  await writeFile(first.configFile, JSON.stringify(config));
  const second = await prepareInstallation(
    installation,
    release,
    () => {},
    undefined,
    run,
  );
  expect(second.config).toEqual(config);
  expect(await readFile(join(installation, "controller-token"), "utf8")).toBe(
    token,
  );
  expect(executed.some((args) => args[0] === "pull")).toBe(true);
  expect(phases).toEqual(["checking", "image", "configuration"]);
  await expect(
    prepareInstallation(
      join(directory, "windows"),
      release,
      () => {},
      undefined,
      async () => JSON.stringify("windows"),
    ),
  ).rejects.toThrow("Linux");
});

test("encrypted backups require stopped writers and restore credentials and files to a new location", async () => {
  const directory = await fixture();
  const root = join(directory, "host");
  const data = join(root, "data");
  await mkdir(data, { recursive: true });
  await writeFile(
    join(root, "domos.config.json"),
    JSON.stringify({ dataDir: data, computer: { kind: "process" } }),
  );
  const secret = crypto.randomUUID();
  await writeFile(join(data, "artifact.txt"), secret);
  const archive = join(directory, "backup.domos");
  const password = crypto.randomUUID();
  const release = await acquireDataLease(data);
  await expect(backupInstallation(root, archive, password)).rejects.toThrow(
    "运行实例",
  );
  await release();
  await backupInstallation(root, archive, password);
  expect((await readFile(archive)).includes(Buffer.from(secret))).toBe(false);
  await expect(
    restoreInstallation(archive, join(directory, "wrong"), "wrong-password"),
  ).rejects.toThrow();
  const target = join(directory, "restored");
  await restoreInstallation(archive, target, password);
  expect(await readFile(join(target, "data/artifact.txt"), "utf8")).toBe(
    secret,
  );
  expect(
    JSON.parse(await readFile(join(target, "domos.config.json"), "utf8"))
      .dataDir,
  ).toBe(join(target, "data"));
  await expect(restoreInstallation(archive, target, password)).rejects.toThrow(
    "新的",
  );
});
