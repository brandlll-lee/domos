import type { Context } from "@earendil-works/chord/context";
import type { CredentialStore } from "@earendil-works/pi-ai";
import type { Models } from "@earendil-works/pi-ai/models";
import {
  type AgentChange,
  Harness,
  type HarnessOptions,
  type Registry,
} from "@earendil-works/pi-durable";
import { Bots, identity } from "./bots.ts";
import type { Computers } from "./computer/catalog.ts";
import { ComputerRuntime } from "./computer/runtime.ts";
import { messaging } from "./delivery.ts";
import { Files } from "./files.ts";
import { history } from "./harness/history.ts";
import { Runtime } from "./runtime/index.ts";
import { migrateRuntime } from "./runtime/migrate.ts";
import { modelDiagnostics } from "./runtime/model-diagnostics.ts";
import { openStorage } from "./runtime/storage.ts";
import { botWork } from "./work/index.ts";
import { memory } from "./work/memory.ts";
import { routineExtension } from "./work/routines.ts";
import { skills } from "./work/skills.ts";

export async function openAgent(
  database: string,
  options: HarnessOptions & {
    registry: Registry;
    models: Models;
    computers?: Computers;
    legacy?: boolean;
    credentials?: CredentialStore;
  },
  agent: AgentChange,
  context: Context,
  files = new Files(database),
) {
  options.registry.install(messaging);
  options.registry.install(history);
  options.registry.install(identity);
  options.registry.install(memory);
  options.registry.install(skills);
  const computers = options.computers;
  let computerRuntime: ComputerRuntime | undefined;
  options.registry.install(
    routineExtension(options.now, async (botId, ctx) => {
      await computers?.preflight(botId, ctx);
      await computerRuntime?.prepare(botId, ctx);
    }),
  );
  const storage = await openStorage(database);
  const models = modelDiagnostics(options.models);
  const harness = await Harness.open(storage, { ...options, models }, context);
  try {
    const conversation = await harness.root(context, { agent });
    const bots = new Bots(harness, options.computers);
    await bots.initialize(conversation.id, context);
    await options.computers?.initialize(
      harness,
      bots,
      context,
      options.legacy,
      options.credentials,
    );
    computerRuntime = computers
      ? new ComputerRuntime(harness, options.registry, computers, files)
      : undefined;
    const engines = new Runtime(harness, models, computerRuntime, files);
    for (const bot of await bots.list(context)) {
      await migrateRuntime(harness, bot.id, context);
      await computerRuntime?.prepare(bot.id, context, false);
    }
    harness.resume();
    return {
      harness,
      conversation,
      bots,
      work: botWork(harness, options.now),
      files,
      models,
      engines,
    };
  } catch (error) {
    await harness.close(context);
    throw error;
  }
}
