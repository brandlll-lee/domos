import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { computerSchema } from "@domos/agent/config";
import { releaseSchema, runCommand } from "@domos/hosting/install";
import {
  backupInstallation,
  restoreInstallation,
} from "@domos/hosting/maintenance";
import { LocalStack } from "@domos/hosting/stack";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { expect, test } from "vitest";
import type { AppRouter } from "../src/router.ts";

const verifyFiles = `
import assert from 'node:assert/strict';
import { Computer } from './src/computer/index.ts';
import { loadConfig } from './src/runtime/config.ts';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { getOrThrow } from '@earendil-works/pi-durable/env';
const config = await loadConfig();
const { targets, write } = JSON.parse(process.argv[1]);
const computers = targets.map(({ id }) => new Computer({ ...config, computer: id === 'process' ? { kind: 'process' } : { ...config.workComputer, id } }));
try {
  const environments = await Promise.all(computers.map((computer, index) => computer.workspace(targets[index].botId, context)));
  for (const [index, env] of environments.entries()) {
    if (write) getOrThrow(await env.writeFile('check.txt', String(index), context));
    assert.equal(getOrThrow(await env.readTextFile('check.txt', context)), String(index));
    assert.equal(getOrThrow(await env.exec(['node', '-e', 'process.exit(0)'], undefined, context)).exitCode, 0);
  }
  if (write) getOrThrow(await environments[1].writeFile('/home/domos/shared.txt', 'shared', context));
  assert.equal(getOrThrow(await environments[2].readTextFile('/home/domos/shared.txt', context)), 'shared');
  assert.equal((await environments[3].readTextFile('/home/domos/shared.txt', context)).ok, false);
  if (write) getOrThrow(await environments[3].writeFile('/home/domos/private.txt', 'private', context));
  assert.equal((await environments[4].readTextFile('/home/domos/private.txt', context)).ok, false);
} finally { await Promise.all(computers.map((computer) => computer.close(context))); }
`;

test.runIf(process.env.DOMOS_CONTAINER_TESTS === "1")(
  "managed service containers prepare mixed Bot environments and restore work files",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "domos-managed-container-"));
    const root = join(directory, "installation");
    const release = releaseSchema.parse(
      JSON.parse(await readFile("deploy/release.json", "utf8")),
    );
    release.serviceImage = "domos-app:test";
    for (const build of [
      release.serviceBuild,
      release.workBuild,
      release.proxyBuild,
    ])
      if (build) build.context = resolve(build.context);
    const installations = [root];
    let stack = new LocalStack(root, release);
    const targets: { botId: number; id: string }[] = [];
    const volumes = new Map<string, string>();
    const client = async () => {
      const { origin } = await stack.start(
        () => {},
        new AbortController().signal,
      );
      const session = await stack.pair();
      return createORPCClient<RouterClient<AppRouter>>(
        new RPCLink({
          url: `${origin}/rpc`,
          headers: { Authorization: `Bearer ${session.token}` },
        }),
      );
    };
    const inspect = async (write: boolean) => {
      const id = await runCommand("docker", [
        "compose",
        "--file",
        join(stack.directory, "compose.json"),
        "ps",
        "--quiet",
        "app",
      ]);
      await runCommand(
        "docker",
        [
          "exec",
          "-w",
          "/app/packages/agent",
          id,
          "node",
          "--input-type=module",
          "-e",
          verifyFiles,
          JSON.stringify({ targets, write }),
        ],
        { timeout: 120_000 },
      );
    };
    try {
      let api = await client();
      expect(await api.computer.setup()).toEqual({
        deployment: "container",
        canIsolate: true,
      });
      for (const mode of [
        "process",
        "shared",
        "shared",
        "dedicated",
        "dedicated",
      ] as const) {
        const bot = await api.bots.create({
          name: mode,
          requestId: crypto.randomUUID(),
          computerId: null,
        });
        const binding = await api.computer.configure({
          botId: bot.id,
          mode,
          revision: 0,
          requestId: crypto.randomUUID(),
        });
        if (!binding.computerId) throw new Error("Computer required");
        targets.push({ botId: bot.id, id: binding.computerId });
        if (mode !== "process")
          volumes.set(binding.computerId, `domos-${binding.computerId}-work`);
        expect(binding.computer?.state).toBe("running");
      }
      expect(targets[1]?.id).toBe(targets[2]?.id);
      expect(targets[3]?.id).not.toBe(targets[4]?.id);
      await inspect(true);
      await stack.stop();
      api = await client();
      for (const target of targets) {
        const binding = await api.computer.get({ botId: target.botId });
        await api.computer.configure({
          botId: target.botId,
          mode:
            target.id === "process"
              ? "process"
              : target === targets[1] || target === targets[2]
                ? "shared"
                : "dedicated",
          revision: binding.revision,
          requestId: crypto.randomUUID(),
        });
      }
      await inspect(false);
      await stack.stop();
      const archive = join(directory, "backup.domos");
      const password = crypto.randomUUID();
      await backupInstallation(root, archive, password);
      const restored = join(directory, "restored");
      await restoreInstallation(archive, restored, password);
      installations.push(restored);
      stack = new LocalStack(restored, release);
      api = await client();
      for (const [index, target] of targets.entries()) {
        const binding = await api.computer.get({ botId: target.botId });
        const mode =
          index === 0 ? "process" : index < 3 ? "shared" : "dedicated";
        const ready = await api.computer.configure({
          botId: target.botId,
          mode,
          revision: binding.revision,
          requestId: crypto.randomUUID(),
        });
        const stored = await runCommand("docker", [
          "exec",
          await runCommand("docker", [
            "compose",
            "--file",
            join(restored, "compose.json"),
            "ps",
            "--quiet",
            "app",
          ]),
          "node",
          "--input-type=module",
          "-e",
          `import { storedComputers } from './packages/agent/src/computer/storage.ts'; const items=await storedComputers('/data/agent.sqlite'); process.stdout.write(JSON.stringify(items.find(item=>item.id===process.argv[1]).config));`,
          ready.computerId ?? "",
        ]);
        const config = computerSchema.parse(JSON.parse(stored));
        target.id = config.kind === "process" ? "process" : config.id;
        if (config.kind === "controller")
          volumes.set(config.id, `domos-${config.id}-work`);
      }
      await inspect(false);
    } finally {
      await stack.stop();
      for (const path of installations)
        await runCommand("docker", [
          "compose",
          "--file",
          join(path, "compose.json"),
          "down",
        ]).catch(() => {});
      for (const [id, volume] of volumes) {
        await runCommand("docker", [
          "rm",
          "--force",
          `domos-${id}`,
          `domos-${id}-egress`,
        ]).catch(() => {});
        await runCommand("docker", ["volume", "rm", volume]).catch(() => {});
        await runCommand("docker", ["network", "rm", `domos-${id}`]).catch(
          () => {},
        );
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
  600_000,
);
