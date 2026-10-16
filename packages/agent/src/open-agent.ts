import type { Context } from "@earendil-works/chord/context";
import {
  type AgentChange,
  Harness,
  type HarnessOptions,
  type Registry,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Bots, identity } from "./bots.ts";
import type { Computers } from "./computer/catalog.ts";
import { messaging } from "./delivery.ts";
import { Files } from "./files.ts";
import { botWork } from "./work/index.ts";
import { memory } from "./work/memory.ts";
import { routineExtension } from "./work/routines.ts";
import { skills } from "./work/skills.ts";

export async function openAgent(
  database: string,
  options: HarnessOptions & {
    registry: Registry;
    computers?: Computers;
    legacy?: boolean;
  },
  agent: AgentChange,
  context: Context,
  files = new Files(database),
) {
  options.registry.install(messaging);
  options.registry.install(identity);
  options.registry.install(memory);
  options.registry.install(skills);
  const computers = options.computers;
  options.registry.install(
    routineExtension(
      options.now,
      computers ? (botId, ctx) => computers.preflight(botId, ctx) : undefined,
    ),
  );
  const storage = await openNodeSqliteStorage(database);
  const harness = await Harness.open(storage, options, context);
  try {
    const conversation = await harness.root(context, { agent });
    const bots = new Bots(harness, options.computers);
    await bots.initialize(conversation.id, context);
    await options.computers?.initialize(harness, bots, context, options.legacy);
    harness.resume();
    return {
      harness,
      conversation,
      bots,
      work: botWork(harness, options.now),
      files,
      models: options.models,
    };
  } catch (error) {
    await harness.close(context);
    throw error;
  }
}
