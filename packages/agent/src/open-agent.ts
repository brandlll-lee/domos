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
import { Collaboration, collaborationExtension } from "./collaboration.ts";
import type { Computers } from "./computer/catalog.ts";
import { ComputerRuntime } from "./computer/runtime.ts";
import { BotSessions } from "./conversations.ts";
import { Files } from "./files.ts";
import { history } from "./harness/history.ts";
import { interactionExtension } from "./harness/interactions.ts";
import { EngineDoc } from "./harness/state.ts";
import { ImageServices, imageExtension } from "./image-services.ts";
import { McpConnections } from "./mcp/connections.ts";
import { messaging } from "./messaging.ts";
import { EngineExecution, engineTask, Runtime } from "./runtime/index.ts";
import { migrateRuntime } from "./runtime/migrate.ts";
import { modelDiagnostics } from "./runtime/model-diagnostics.ts";
import { modelImages } from "./runtime/model-images.ts";
import { checkpointEngineState, openStorage } from "./runtime/storage.ts";
import { Teams } from "./teams.ts";
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
    maintenance?: boolean;
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
  let images: ImageServices;
  let bots: Bots;
  if (computers)
    options.registry.install(
      imageExtension(
        () => images,
        () => bots,
      ),
    );
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
  if (execution) options.registry.install(execution.mcpExtension());
  if (execution) options.registry.install(interactionExtension(execution));
  let engines: Runtime | undefined;
  let collaboration: Collaboration;
  if (execution)
    options.registry.install(collaborationExtension(() => collaboration));
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
              async (title, detail, context, presentation) =>
                (
                  await computer.approve(
                    botId,
                    {
                      id: `routine:${requestId}`,
                      title,
                      detail,
                      ...presentation,
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
  try {
    await checkpointEngineState(storage, context);
  } catch (error) {
    await storage.close(context);
    throw error;
  }
  const models = modelDiagnostics(options.models);
  const harness = await Harness.open(storage, { ...options, models }, context);
  try {
    const conversation = await harness.root(context, { agent });
    bots = new Bots(harness, options.computers, database);
    bots.files = files;
    if (computers) {
      images = new ImageServices(
        harness,
        computers,
        files,
        options.credentials,
      );
      bots.images = images;
    }
    const mcp = new McpConnections(harness, options.credentials);
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
    if (execution && computerRuntime && computers) {
      mcp.runner = (computerId, input, signal) =>
        computers.mcp(computerId, input, context, signal);
      mcp.nativeCatalog = async (botId, ctx, signal) => {
        const doc = await harness.snapshot(
          EngineDoc,
          botId as import("@earendil-works/pi-durable").ConversationId,
          ctx,
        );
        if (!doc?.computerId)
          throw new Error("请先选择 Bot 的工作电脑和 Harness。");
        const catalog = await execution.nativeCatalog(
          botId,
          doc.config,
          ctx,
          signal,
        );
        return {
          ...catalog,
          provider: doc.config.provider,
          computerId: doc.computerId,
          inheritance:
            doc.config.provider === "claude" ? "selectable" : "native",
          readonly: true,
          inherited: await mcp.native(botId, ctx),
        };
      };
      execution.mcp = mcp;
      execution.computer = computerRuntime;
      computerRuntime.onWaiting = (botId, status) =>
        execution.waiting(botId, status);
      engines = new Runtime(harness, execution, database);
      collaboration = new Collaboration(harness, engines, files);
      engines.collaboration = collaboration;
    }
    for (const bot of await bots.list(context)) {
      await migrateRuntime(harness, bot.id, context);
      await computerRuntime?.prepare(bot.id, context, false);
    }
    for (const session of (await harness.snapshot(BotSessions, context))
      ?.items ?? [])
      await computerRuntime?.prepare(session.id, context, false);
    await bots.migrateCharacters(context);
    routines = new Routines(harness, options.now);
    if (options.maintenance) {
      if (!engines) throw new Error("维护模式需要任务引擎。");
      await engines.maintenance(true, context);
    } else if (!(await engines?.maintenance(undefined, context)))
      harness.resume();
    return {
      harness,
      conversation,
      bots,
      teams: new Teams(harness),
      work: botWork(harness, options.now, files),
      files,
      models,
      engines,
      mcp,
    };
  } catch (error) {
    await harness.close(context);
    throw error;
  }
}
