import type { Models } from "@earendil-works/pi-ai/models";

export async function modelCatalog(models: Models) {
  return (await models.getAvailable()).map((model) => ({
    provider: model.provider,
    modelId: model.id,
    name: model.name,
    providerName: models.getProvider(model.provider)?.name ?? model.provider,
  }));
}
