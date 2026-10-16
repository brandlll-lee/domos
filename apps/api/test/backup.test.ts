import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openChat } from "@domos/agent/chat";
import { storedComputers } from "@domos/agent/computer/storage";
import { parseConfig } from "@domos/agent/config";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import { expect, onTestFinished, test } from "vitest";
import {
  prepareLocalInstallation,
  type Release,
} from "../../../packages/hosting/src/install.ts";
import {
  backupInstallation,
  restoreInstallation,
} from "../../../packages/hosting/src/maintenance.ts";

const release: Release = {
  version: "test",
  workImage: "test-image:1",
  controllerEntry: "controller.ts",
  serverEntry: "server.ts",
  bridgeEntry: "bridge.ts",
  staticDir: "web",
};

test("encrypted backups preserve computer permissions, bindings and native workspaces", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-backup-test-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, "host");
  const installation = await prepareLocalInstallation(root, release);
  const context = BACKGROUND_CONTEXT;
  const runtime = await openChat(
    context,
    parseConfig(installation.config, installation.configFile),
  );
  let botId: number;
  try {
    await runtime.computer.authorize("process", true, context);
    const bot = await runtime.bots.create(
      { name: "Writer", computerId: "process", requestId: crypto.randomUUID() },
      context,
    );
    botId = bot.id;
    const workspace = await runtime.computer.workspace(bot.id, context);
    getOrThrow(
      await workspace.writeFile(
        await workspace.path("draft.txt"),
        new TextEncoder().encode("A saved draft"),
        context,
      ),
    );
  } finally {
    await runtime.close();
  }
  const records = await storedComputers(join(root, "data", "agent.sqlite"));
  const archive = join(directory, "backup.domos");
  const password = crypto.randomUUID();
  await backupInstallation(root, archive, password);
  const target = join(directory, "restored");
  await restoreInstallation(archive, target, password);
  expect(await storedComputers(join(target, "data", "agent.sqlite"))).toEqual(
    records,
  );
  const restored = await openChat(
    context,
    parseConfig(
      { dataDir: join(target, "data") },
      join(target, "domos.config.json"),
    ),
  );
  try {
    expect((await restored.computer.binding(botId, context)).computerId).toBe(
      "process",
    );
    const workspace = await restored.computer.workspace(botId, context);
    expect(
      getOrThrow(
        await workspace.readTextFile(
          await workspace.path("draft.txt"),
          context,
        ),
      ),
    ).toBe("A saved draft");
  } finally {
    await restored.close();
  }
});
