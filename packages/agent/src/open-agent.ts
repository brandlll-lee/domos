import type { Context } from "@earendil-works/chord/context";
import {
  type AgentChange,
  Harness,
  type HarnessOptions,
  type Registry,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Bots, identity } from "./bots.ts";
import { messaging } from "./delivery.ts";
import { Files } from "./files.ts";
import { botWork } from "./work/index.ts";
import { memory } from "./work/memory.ts";
import { routineExtension } from "./work/routines.ts";
import { skills } from "./work/skills.ts";

export async function openAgent(
  database: string,
  options: HarnessOptions & { registry: Registry },
  agent: AgentChange,
  context: Context,
) {
  options.registry.install(messaging);
  options.registry.install(identity);
  options.registry.install(memory);
  options.registry.install(skills);
  options.registry.install(routineExtension(options.now));
  const storage = await openNodeSqliteStorage(database);
  const harness = await Harness.open(storage, options, context);
  try {
    const conversation = await harness.root(context, { agent });
    const bots = new Bots(harness);
    await bots.initialize(conversation.id, context);
    harness.resume();
    return {
      harness,
      conversation,
      bots,
      work: botWork(harness, options.now),
      files: new Files(database),
      models: options.models,
    };
  } catch (error) {
    await harness.close(context);
    throw error;
  }
}
