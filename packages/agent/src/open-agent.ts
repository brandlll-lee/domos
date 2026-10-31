import type { Context } from "@earendil-works/chord/context";
import type { CredentialStore } from "@earendil-works/pi-ai";
import type { Models } from "@earendil-works/pi-ai/models";
import {
  type AgentChange,
  defineExtension,
  Harness,
  type HarnessOptions,
  type Registry,
} from "@earendil-works/pi-durable";
import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
import { Bots, identity } from "./bots.ts";
import type { Computers } from "./computer/catalog.ts";
import { ComputerRuntime } from "./computer/runtime.ts";
import { Files } from "./files.ts";
import { history } from "./harness/history.ts";
import { messaging } from "./messaging.ts";
import { EngineExecution, engineTask, Runtime } from "./runtime/index.ts";
import { migrateRuntime } from "./runtime/migrate.ts";
import { modelDiagnostics } from "./runtime/model-diagnostics.ts";
import { modelImages } from "./runtime/model-images.ts";
import { openStorage } from "./runtime/storage.ts";
import { botWork } from "./work/index.ts";
import { memory } from "./work/memory.ts";
import { Routines, routineExtension } from "./work/routines.ts";
import { skillExtension } from "./work/skills.ts";

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
  options.registry.install(modelImages(await createNodePhotonImages()));
  options.registry.install(messaging);
  options.registry.install(history);
  options.registry.install(identity);
  options.registry.install(memory);
  options.registry.install(skillExtension(files));
  const computers = options.computers;
  const execution = computers
    ? new EngineExecution(computers, files)
    : undefined;
  if (execution)
    options.registry.install(
      defineExtension({
        name: "domos-engines",
        tasks: [engineTask(execution)],
      }),
    );
  let engines: Runtime | undefined;
  let computerRuntime: ComputerRuntime | undefined;
  let routines: Routines;
  options.registry.install(
    routineExtension(
      options.now,
      async (botId, ctx) => {
        await computers?.preflight(botId, ctx);
        await computerRuntime?.prepare(botId, ctx);
      },
      execution
        ? (botId, input, ctx) => {
            if (!engines) throw new Error("任务引擎尚未启动。");
            return engines.submit(botId, { ...input, source: "routine" }, ctx);
          }
        : undefined,
      execution
        ? async (botId, change, requestId, ctx) => {
            const computer = computerRuntime;
            if (!computer) throw new Error("确认服务尚未启动。");
            return routines.manage(
              botId,
              change,
              requestId,
              async (title, detail, context) =>
                (
                  await computer.approve(
                    botId,
                    {
                      id: `routine:${requestId}`,
                      title,
                      detail,
                      kind: "permission",
                      automatic: false,
                    },
                    context.abortSignal ?? new AbortController().signal,
                    context,
                  )
                ).allow,
              ctx,
            );
          }
        : undefined,
    ),
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
    if (execution && computerRuntime) {
      execution.computer = computerRuntime;
      computerRuntime.onWaiting = (botId, status) =>
        execution.waiting(botId, status);
      engines = new Runtime(harness, execution);
    }
    for (const bot of await bots.list(context)) {
      await migrateRuntime(harness, bot.id, context);
      await computerRuntime?.prepare(bot.id, context, false);
    }
    routines = new Routines(harness, options.now);
    harness.resume();
    return {
      harness,
      conversation,
      bots,
      work: botWork(harness, options.now, files),
      files,
      models,
      engines,
    };
  } catch (error) {
    await harness.close(context);
    throw error;
  }
}
