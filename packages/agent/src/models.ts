import {
  getSupportedThinkingLevels,
  type Models,
} from "@earendil-works/pi-ai/models";

export function thinkingControl(
  model: Parameters<typeof getSupportedThinkingLevels>[0],
) {
  return {
    id: "thinkingLevel",
    kind: "effort" as const,
    label: "推理强度",
    value: "",
    options: getSupportedThinkingLevels(model).map((id) => ({ id, label: id })),
  };
}

export async function modelCatalog(models: Models) {
  return (await models.getAvailable()).map((model) => ({
    provider: model.provider,
    modelId: model.id,
    name: model.name,
    providerName: models.getProvider(model.provider)?.name ?? model.provider,
    effort: thinkingControl(model),
  }));
}
