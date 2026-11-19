import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireDataLease } from "@domos/agent/lease";
import { expect, onTestFinished, test } from "vitest";
import {
  checkDocker,
  prepareImage,
  prepareInstallation,
  prepareLocalInstallation,
  publishedReleaseSchema,
  type Release,
  runCommand,
  startDocker,
} from "../src/install.ts";
import { backupInstallation, restoreInstallation } from "../src/maintenance.ts";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "domos-install-test-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
const release: Release = {
  version: "test",
  workImage: `registry/work@sha256:${"a".repeat(64)}`,
  controllerEntry: "controller.ts",
  serverEntry: "server.ts",
  bridgeEntry: "bridge.ts",
  staticDir: "web",
};

test("installation commands retain exit diagnostics behind a user-facing error", async () => {
  await expect(
    runCommand(process.execPath, [
      "-e",
      "process.stderr.write('fixture command failed'); process.exitCode = 23",
    ]),
  ).rejects.toMatchObject({
    message: "安装步骤未完成。请检查网络和运行环境后重试。",
    cause: {
      command: process.execPath,
      exitCode: 23,
      stderr: "fixture command failed",
    },
  });
});

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

test("installation checks Linux mode and preserves configuration without downloading work images", async () => {
  const directory = await fixture();
  const installation = join(directory, "host");
  const phases: string[] = [];
  let missingImage = true;
  const executed: string[][] = [];
  const run = async (_command: string, args: string[]) => {
    executed.push(args);
    if (args[0] === "info") return JSON.stringify("linux");
    if (args[0] === "image" && missingImage)
      throw new Error("Missing image", { cause: { stderr: "No such image" } });
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
  expect(executed.some((args) => args[0] === "pull")).toBe(false);
  expect(phases).toEqual(["checking", "configuration"]);
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

test("published releases require immutable images and cached images stay offline", async () => {
  expect(() => publishedReleaseSchema.parse(release)).toThrow();
  const complete = {
    ...release,
    serviceImage: release.workImage,
    proxyImage: release.workImage,
  };
  const published = publishedReleaseSchema.parse(complete);
  expect(published).toEqual(complete);
  expect(() =>
    publishedReleaseSchema.parse({
      ...complete,
      serviceImage: "service:latest",
    }),
  ).toThrow();
  const commands: string[][] = [];
  await prepareImage(
    published.serviceImage,
    () => {},
    undefined,
    async (_command, args) => {
      commands.push(args);
      return "found";
    },
  );
  expect(commands).toHaveLength(1);
  expect(commands[0]).toEqual(["image", "inspect", complete.serviceImage]);
  await expect(
    prepareImage(
      published.serviceImage,
      () => {},
      undefined,
      async () => {
        throw new Error("Access denied");
      },
    ),
  ).rejects.toThrow("Access denied");
});

test("Docker checks distinguish installation, stopped engine, mode and permissions", async () => {
  for (const [code, cause] of [
    ["missing", { code: "ENOENT" }],
    [
      "stopped",
      {
        stderr:
          "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?",
      },
    ],
    [
      "stopped",
      {
        stderr:
          "open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.",
      },
    ],
    ["connection", { stderr: "permission denied while trying to connect" }],
  ] as const) {
    await expect(
      checkDocker(undefined, async () => {
        throw new Error("Docker failed", { cause });
      }),
    ).rejects.toMatchObject({ code });
  }
  await expect(
    checkDocker(undefined, async () => '"windows"'),
  ).rejects.toMatchObject({ code: "mode" });
});

test("Docker Desktop waits for readiness after one start and respects cancellation", async () => {
  let checks = 0;
  const commands: string[][] = [];
  const signal = new AbortController().signal;
  await startDocker(
    signal,
    () => {},
    async (_command, args) => {
      commands.push(args);
      if (args[0] === "info" && ++checks === 1)
        throw new Error("not running", {
          cause: { stderr: "Cannot connect to the Docker daemon" },
        });
      return '"linux"';
    },
  );
  expect(commands.filter((args) => args[0] === "desktop")).toHaveLength(1);
  expect(checks).toBe(2);
  const controller = new AbortController();
  controller.abort();
  await expect(
    startDocker(
      controller.signal,
      () => {},
      async () => {
        throw new Error("Must not execute");
      },
    ),
  ).rejects.toThrow(/abort/i);
});
