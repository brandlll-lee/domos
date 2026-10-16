import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { Context } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai/models";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { createRegistry } from "@earendil-works/pi-durable";
import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
import { Computers } from "./computer/catalog.ts";
import { computersExtension, shellTools } from "./computer.ts";
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
  const release =
    options.lease === false
      ? async () => {}
      : await acquireDataLease(config.dataDir);
  const computer = new Computers(config);
  try {
    const database = join(config.dataDir, "agent.sqlite");
    const legacy = await stat(join(config.dataDir, "computer.json")).then(
      () => true,
      (error) => {
        if (error.code !== "ENOENT") throw error;
        return false;
      },
    );
    const files = new Files(
      database,
      (botId, ctx) => computer.workspace(botId, ctx),
      (botId, ctx) => computer.computerId(botId, ctx),
      (ctx) => computer.attachmentComputerId(ctx),
    );
    const registry = createRegistry();
    const fileTools = files.extension(await createNodePhotonImages());
    registry.install(fileTools);
    registry.install(computersExtension(computer));
    computer.install([...shellTools, ...(fileTools.tools ?? [])], shellTools);
    const runtime = await openAgent(
      database,
      {
        models,
        registry,
        computers: computer,
        legacy,
        env: ({ conversationId, read }, ctx) =>
          computer.environment(conversationId, ctx, read),
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
