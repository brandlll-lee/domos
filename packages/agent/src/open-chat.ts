import { readFile } from "node:fs/promises";
import type { Context } from "@earendil-works/chord/context";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { createRegistry, type ModelRef } from "@earendil-works/pi-durable";
import { openAgent } from "./open-agent.ts";

export async function openChat(database: string, context: Context) {
  const models = builtinModels();
  const config = JSON.parse(await readFile("domos.config.json", "utf8")) as {
    model?: ModelRef;
  };
  if (
    !config.model ||
    !models.getModel(config.model.provider, config.model.modelId)
  )
    throw new Error("请检查 domos.config.json 中的初始模型。");
  return openAgent(
    database,
    { models, registry: createRegistry() },
    { model: config.model },
    context,
  );
}
