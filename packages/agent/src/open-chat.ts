import { join } from "node:path";
import type { Context } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai/models";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { createRegistry } from "@earendil-works/pi-durable";
import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
import { Computer } from "./computer/index.ts";
import { computerExtension } from "./computer.ts";
import { Files } from "./files.ts";
import { openAgent } from "./open-agent.ts";
import { loadConfig, type RuntimeConfig } from "./runtime/config.ts";
import { acquireDataLease } from "./runtime/lease.ts";

export async function openChat(
  context: Context,
  supplied?: RuntimeConfig,
  options: { models?: Models; lease?: boolean } = {},
) {
  const config = supplied ?? (await loadConfig());
  const models = options.models ?? builtinModels();
  if (
    !config.model ||
    !models.getModel(config.model.provider, config.model.modelId)
  )
    throw new Error("请检查配置中的初始模型。");
  const release =
    options.lease === false
      ? async () => {}
      : await acquireDataLease(config.dataDir);
  const computer = new Computer(config);
  try {
    await computer.bind();
    const database = join(config.dataDir, "agent.sqlite");
    const files = new Files(database, (botId, ctx) =>
      computer.workspace(botId, ctx),
    );
    const registry = createRegistry();
    registry.install(files.extension(await createNodePhotonImages()));
    registry.install(computerExtension(computer));
    const runtime = await openAgent(
      database,
      {
        models,
        registry,
        env: ({ conversationId }) => files.workspace(conversationId, context),
      },
      { model: config.model },
      context,
      files,
    );
    let closed = false;
    return {
      ...runtime,
      config,
      computer,
      async close() {
        if (closed) return;
        closed = true;
        try {
          await runtime.harness.close(context);
        } finally {
          try {
            await computer.close(context);
          } finally {
            await release();
          }
        }
      },
    };
  } catch (error) {
    try {
      await computer.close(context);
    } finally {
      await release();
    }
    throw error;
  }
}
