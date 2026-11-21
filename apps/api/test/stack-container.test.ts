import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const computers = targets.map(() => new Computer(config));
try {
  const environments = await Promise.all(computers.map((computer, index) => computer.workspace(targets[index].botId, context)));
  for (const [index, env] of environments.entries()) {
    if (write) getOrThrow(await env.writeFile('check.txt', String(index), context));
    assert.equal(getOrThrow(await env.readTextFile('check.txt', context)), String(index));
    assert.equal(getOrThrow(await env.exec(['node', '-e', 'process.exit(0)'], undefined, context)).exitCode, 0);
  }
  assert.notEqual(environments[0].cwd, environments[1].cwd);
} finally { await Promise.all(computers.map((computer) => computer.close(context))); }
`;

test.runIf(process.env.DOMOS_CONTAINER_TESTS === "1")(
  "container hosting preserves Bot work directories across restarts and backup restore",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "domos-managed-container-"));
    const root = join(directory, "installation");
    const release = releaseSchema.parse(
      JSON.parse(await readFile("deploy/release.json", "utf8")),
    );
    release.serviceImage = "domos-app:test";
    release.workImage = "domos-workspace:1.2.0";
    release.proxyImage = "domos-egress:1";
    const installations = [root];
    let stack = new LocalStack(root, release);
    const targets: { botId: number; id: string }[] = [];
    const client = async () => {
      const { origin } = await stack.start(
        () => {},
        new AbortController().signal,
      );
      const session = await stack.pair({ installationId: crypto.randomUUID() });
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
      for (const name of ["Writer", "Reviewer"]) {
        const bot = await api.bots.create({
          name,
          requestId: crypto.randomUUID(),
        });
        const binding = await api.computer.configure({
          botId: bot.id,
          mode: "process",
          revision: 0,
          requestId: crypto.randomUUID(),
        });
        expect(binding.computerId).toBe("process");
        targets.push({ botId: bot.id, id: "process" });
        expect(binding.computer?.state).toBe("running");
      }
      await inspect(true);
      await stack.stop();
      api = await client();
      for (const target of targets) {
        const binding = await api.computer.get({ botId: target.botId });
        await api.computer.configure({
          botId: target.botId,
          mode: "process",
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
      for (const target of targets) {
        const binding = await api.computer.get({ botId: target.botId });
        const ready = await api.computer.configure({
          botId: target.botId,
          mode: "process",
          revision: binding.revision,
          requestId: crypto.randomUUID(),
        });
        expect(ready.computerId).toBe(target.id);
      }
      await inspect(false);
    } catch (error) {
      const logs = await runCommand("docker", [
        "compose",
        "--file",
        join(stack.directory, "compose.json"),
        "logs",
        "--no-color",
        "--tail",
        "30",
      ]).catch(() => "");
      console.error(logs);
      throw error;
    } finally {
      await stack.stop();
      for (const path of installations)
        await runCommand("docker", [
          "compose",
          "--file",
          join(path, "compose.json"),
          "down",
        ]).catch(() => {});
      await rm(directory, { recursive: true, force: true });
    }
  },
  600_000,
);
