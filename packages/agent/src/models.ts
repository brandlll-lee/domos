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

export async function modelProviders(models: Models) {
  return Promise.all(
    models.getProviders().map(async (provider) => ({
      id: provider.id,
      name: provider.name,
      methods: [
        ...(provider.auth.apiKey?.login
          ? [{ type: "api_key", name: provider.auth.apiKey.name }]
          : []),
        ...(provider.auth.oauth
          ? [{ type: "oauth", name: provider.auth.oauth.name }]
          : []),
      ],
      configured: Boolean(await models.checkAuth(provider.id)),
      dynamic: Boolean(provider.refreshModels),
    })),
  );
}
