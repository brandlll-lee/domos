import type { Context } from "@earendil-works/chord/context";
import type { CredentialStore } from "@earendil-works/pi-ai";
import {
  type AgentChange,
  defineExtension,
  Harness,
  type HarnessOptions,
  type Registry,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Bots, identity } from "./bots.ts";
import type { Computers } from "./computer/catalog.ts";
import { messaging } from "./delivery.ts";
import { Files } from "./files.ts";
import { EngineExecution, Engines, engineTask } from "./harness/index.ts";
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
    credentials?: CredentialStore;
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
  const execution = computers
    ? new EngineExecution(computers, options.credentials, options.models)
    : undefined;
  if (execution)
    options.registry.install(
      defineExtension({
        name: "domos-engines",
        tasks: [engineTask(execution)],
      }),
    );
  let engines: Engines | undefined;
  options.registry.install(
    routineExtension(
      options.now,
      computers ? (botId, ctx) => computers.preflight(botId, ctx) : undefined,
      execution
        ? (botId, input, ctx) => {
            if (!engines) throw new Error("任务引擎尚未启动。");
            return engines.submit(botId, input, ctx);
          }
        : undefined,
    ),
  );
  const storage = await openNodeSqliteStorage(database);
  const harness = await Harness.open(storage, options, context);
  try {
    const conversation = await harness.root(context, { agent });
    const bots = new Bots(harness, options.computers);
    await bots.initialize(conversation.id, context);
    await options.computers?.initialize(harness, bots, context, options.legacy);
    if (execution) engines = new Engines(harness, execution);
    harness.resume();
    return {
      harness,
      conversation,
      bots,
      work: botWork(harness, options.now),
      files,
      models: options.models,
      engines,
    };
  } catch (error) {
    await harness.close(context);
    throw error;
  }
}
