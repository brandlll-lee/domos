import { openAgent } from "@domos/agent";
import type { Context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { createRegistry } from "@earendil-works/pi-durable";

export async function openChat(database: string, context: Context) {
  const models = createModels();
  models.setProvider(deepseekProvider());
  if (!(await models.getAuth("deepseek"))) {
    throw new Error("请在 .env 中填写 DEEPSEEK_API_KEY。");
  }
  return openAgent(
    database,
    { models, registry: createRegistry() },
    { model: { provider: "deepseek", modelId: "deepseek-flash" } },
    context,
  );
}
