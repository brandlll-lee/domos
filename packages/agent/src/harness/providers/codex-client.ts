import { z } from "zod";
import { EngineRequestRejected, JsonLines } from "../json-lines.ts";
import { mcpCatalog, mcpEntries, mcpReadError } from "../mcp-catalog.ts";
import type {
  EngineConfig,
  EngineControls,
  EngineProcess,
  EngineQuota,
  EngineSkill,
} from "../types.ts";

export async function openCodexClient(
  process: EngineProcess,
  config: EngineConfig,
  env?: Record<string, string>,
  servers: { name: string; url: string }[] = [],
) {
  const ready = await process.ready;
  const rpc = new JsonLines(process);
  await process.launch({
    command: config.command ?? "codex",
    args: [
      "app-server",
      "--listen",
      "stdio://",
      "-c",
      `mcp_servers.domos.url=${JSON.stringify(ready.url)}`,
      ...(ready.tools?.some((name) => name.startsWith("browser_agent_browser_"))
        ? [
            "-c",
            "features.browser_use=false",
            "-c",
            "features.browser_use_external=false",
          ]
        : []),
      ...(ready.tools?.includes("get_window_state")
        ? ["-c", "features.computer_use=false"]
        : []),
      ...servers.flatMap(({ name, url }) => [
        "-c",
        `mcp_servers.${name}.url=${JSON.stringify(url)}`,
      ]),
    ],
    env,
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
  const skills = async () => {
    const result = await rpc
      .request<{
        data: {
          skills: (EngineSkill & { scope?: string; enabled?: boolean })[];
        }[];
      }>("skills/list", { cwds: [ready.cwd] })
      .catch((error: unknown) => {
        if (error instanceof EngineRequestRejected && error.code === -32601)
          return undefined;
        throw error;
      });
    if (!result) return undefined;
    return result.data.flatMap((entry) =>
      entry.skills
        .filter((skill) => skill.enabled !== false)
        .map((skill) => ({
          name: skill.name,
          description: skill.description,
          path: skill.path,
          source: skill.scope ?? "codex",
        })),
    );
  };
  const mcp = async (threadId?: string, signal?: AbortSignal) => {
    const items: import("../types.ts").EngineMcpCatalog["items"] = [];
    const cursors = new Set<string>();
    const errors: import("../types.ts").EngineMcpCatalog["errors"] = [];
    let cursor: string | null = null;
    try {
      do {
        const page = z
          .object({
            data: z.array(z.unknown()),
            nextCursor: z.string().nullable().optional(),
          })
          .parse(
            await rpc.request(
              "mcpServerStatus/list",
              {
                ...(threadId ? { threadId } : {}),
                limit: 100,
                ...(cursor ? { cursor } : {}),
              },
              undefined,
              signal,
            ),
          );
        const parsed = mcpEntries(
          z.object({
            name: z.string().min(1),
            authStatus: z.string().optional(),
            status: z.string().optional(),
          }),
          page.data,
        );
        errors.push(...parsed.errors);
        items.push(
          ...parsed.items.map((item) => ({
            name: item.name,
            source: "codex",
            enabled: null,
            status: item.status ?? "unknown",
            authStatus: item.authStatus,
          })),
        );
        cursor = page.nextCursor ?? null;
        if (cursor && cursors.has(cursor))
          throw new Error("Codex MCP 目录分页游标重复。");
        if (cursor) cursors.add(cursor);
      } while (cursor);
      return mcpCatalog(items, "session", errors);
    } catch (error) {
      signal?.throwIfAborted();
      const failed = mcpReadError(error, "session");
      return items.length
        ? mcpCatalog(items, "session", [...errors, ...failed.errors])
        : failed;
    }
  };
  return {
    async quota(): Promise<EngineQuota> {
      const source = "codex.account/rateLimits/read";
      const observedAt = Date.now();
      const base = { source, observedAt, windows: [] };
      const account = await rpc.request<{
        account?: { type?: string };
        requiresOpenaiAuth?: boolean;
      }>("account/read", { refreshToken: false });
      if (!account.account && account.requiresOpenaiAuth !== false)
        return {
          ...base,
          status: "signed-out",
          message: "请先在工作电脑登录 Codex。",
        };
      if (
        account.account?.type === "apiKey" ||
        (!account.account && account.requiresOpenaiAuth === false)
      )
        return {
          ...base,
          status: "unsupported",
          message: "API 账号未提供订阅额度。",
        };
      const window = z
        .object({
          usedPercent: z.number().min(0).max(100),
          windowDurationMins: z.number().nonnegative().nullish(),
          resetsAt: z.number().nonnegative().nullish(),
        })
        .nullable()
        .optional();
      const limit = z.object({
        limitName: z.string().nullish(),
        primary: window,
        secondary: window,
        credits: z
          .object({
            hasCredits: z.boolean(),
            unlimited: z.boolean(),
            balance: z.string().nullish(),
          })
          .nullish(),
      });
      let result: unknown;
      try {
        result = await rpc.request("account/rateLimits/read");
      } catch (error) {
        if (error instanceof EngineRequestRejected && error.code === -32601)
          return {
            ...base,
            status: "unsupported",
            message: "此 Codex 版本不支持额度读取。",
          };
        throw error;
      }
      const parsed = z
        .object({
          rateLimits: limit.nullish(),
          rateLimitsByLimitId: z.record(z.string(), limit.nullable()).nullish(),
        })
        .parse(result);
      const entries =
        parsed.rateLimitsByLimitId &&
        Object.keys(parsed.rateLimitsByLimitId).length
          ? Object.entries(parsed.rateLimitsByLimitId)
          : parsed.rateLimits
            ? [["codex", parsed.rateLimits] as const]
            : [];
      const windows: EngineQuota["windows"] = [];
      for (const [id, value] of entries) {
        if (!value) continue;
        for (const key of ["primary", "secondary"] as const) {
          const item = value[key];
          if (!item) continue;
          windows.push({
            id: `${id}:${key}`,
            name: `${value.limitName ?? id} · ${item.windowDurationMins ? `${item.windowDurationMins / 60} 小时` : key === "primary" ? "主要窗口" : "次要窗口"}`,
            usedPercent: item.usedPercent,
            durationMinutes: item.windowDurationMins ?? null,
            resetsAt: item.resetsAt == null ? null : item.resetsAt * 1000,
          });
        }
      }
      const credits = parsed.rateLimits?.credits;
      return {
        ...base,
        status: windows.length || credits ? "ready" : "empty",
        windows,
        ...(credits
          ? {
              credits: {
                available: credits.hasCredits,
                unlimited: credits.unlimited,
                balance: credits.balance ?? null,
              },
            }
          : {}),
      };
    },
    mcp,
    skills,
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
        effort: {
          id: "effort",
          kind: "effort" as const,
          defaultValue: model.defaultReasoningEffort,
          label: "推理强度",
          value: model.defaultReasoningEffort ?? "",
          options: (model.supportedReasoningEfforts ?? []).map((item) => ({
            id: item.reasoningEffort,
            label: item.description,
          })),
        },
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
