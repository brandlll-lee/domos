import { EngineRequestRejected, JsonLines } from "../json-lines.ts";
import type { EngineConfig, EngineControls, EngineProcess } from "../types.ts";

export async function openCodexClient(
  process: EngineProcess,
  config: EngineConfig,
  env?: Record<string, string>,
) {
  const ready = await process.ready;
  const rpc = new JsonLines(process);
  await process.launch({
    command: "codex",
    accountSource: config.accountSource,
    args: [
      "app-server",
      "--listen",
      "stdio://",
      "-c",
      `mcp_servers.domos.url=${JSON.stringify(ready.url)}`,
    ],
    env: {
      ...env,
      ...(config.accountSource === "native"
        ? {}
        : { CODEX_HOME: `${ready.home}/codex` }),
    },
  });
  await rpc.request("initialize", {
    clientInfo: { name: "domos", version: "1.0.0" },
    capabilities: { experimentalApi: true },
  });
  await rpc.send({ method: "initialized", params: {} });
  if (env?.OPENAI_API_KEY)
    await rpc.request("account/login/start", {
      type: "apiKey",
      apiKey: env.OPENAI_API_KEY,
    });
  let modeCatalog:
    | {
        name: string;
        mode: string;
        model: string;
        reasoning_effort?: string | null;
      }[]
    | undefined;
  async function modes() {
    if (!modeCatalog) {
      try {
        modeCatalog =
          (
            await rpc.request<{ data: NonNullable<typeof modeCatalog> }>(
              "collaborationMode/list",
            )
          ).data ?? [];
      } catch (error) {
        if (!(error instanceof EngineRequestRejected)) throw error;
        modeCatalog = [];
      }
    }
    return modeCatalog;
  }
  type Model = {
    id: string;
    model?: string;
    displayName?: string;
    inputModalities?: string[];
    isDefault?: boolean;
    defaultReasoningEffort?: string;
    supportedReasoningEfforts?: {
      reasoningEffort: string;
      description: string;
    }[];
  };
  let modelCatalog: Model[] | undefined;
  async function catalog() {
    if (modelCatalog) return modelCatalog;
    const models: Model[] = [];
    let cursor: string | null = null;
    do {
      const page: { data?: Model[]; nextCursor?: string | null } =
        await rpc.request("model/list", {
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });
      models.push(...(page.data ?? []));
      cursor = page.nextCursor ?? null;
    } while (cursor);
    modelCatalog = models;
    return models;
  }
  async function vision() {
    const model = (await catalog()).find((item) =>
      config.model
        ? item.id === config.model || item.model === config.model
        : item.isDefault,
    );
    return model?.inputModalities
      ? model.inputModalities.includes("image")
      : null;
  }
  return {
    rpc,
    modes,
    async controls(): Promise<EngineControls> {
      const selected = (await catalog()).find((item) =>
        config.model
          ? item.id === config.model || item.model === config.model
          : item.isDefault,
      );
      return {
        compact: true,
        commands: [],
        options: [
          {
            id: "effort",
            kind: "effort",
            defaultValue: selected?.defaultReasoningEffort,
            label: "推理强度",
            value:
              config.options?.effort ?? selected?.defaultReasoningEffort ?? "",
            options: (selected?.supportedReasoningEfforts ?? []).map(
              (item) => ({
                id: item.reasoningEffort,
                label: item.description,
              }),
            ),
          },
          {
            id: "approvalPolicy",
            label: "工作模式",
            value: config.options?.approvalPolicy ?? "on-request",
            options: [
              { id: "on-request", label: "按需确认" },
              { id: "untrusted", label: "受限操作确认" },
            ],
          },
          {
            id: "mode",
            label: "协作模式",
            value: config.options?.mode ?? "",
            options: (await modes()).map((item) => ({
              id: item.mode,
              label: item.name,
            })),
          },
        ],
      };
    },
    models: async () =>
      (await catalog()).map((model) => ({
        id: model.id,
        name: model.displayName ?? model.id,
        ...(model.inputModalities
          ? { images: model.inputModalities.includes("image") }
          : {}),
      })),
    vision,
    authenticated: async () => {
      const account = await rpc.request<{
        account?: unknown;
        requiresOpenaiAuth?: boolean;
      }>("account/read", {
        refreshToken: false,
      });
      return Boolean(account.account) || account.requiresOpenaiAuth === false;
    },
  };
}
