import { type EngineModel, type EngineProcess, engineLimits } from "./types.ts";

export type AccountPrompt = {
  type: "text" | "select";
  key: string;
  message: string;
  placeholder?: string;
  options?: { label: string; value: string; hint?: string }[];
  when?: { key: string; op: "eq" | "neq"; value: string };
};
export type AccountMethod = {
  type: "oauth" | "api";
  label: string;
  prompts?: AccountPrompt[];
};
export type AccountProvider = {
  id: string;
  name: string;
  connected: boolean;
  methods: AccountMethod[];
};
type NativeProvider = {
  id: string;
  name: string;
  models: Record<string, { id: string; name: string; status?: string }>;
};
type Authorization = {
  url: string;
  method: "auto" | "code";
  instructions: string;
};

export async function openOpenCodeAccount(
  worker: EngineProcess,
  env: Record<string, string> = {},
) {
  const { home } = await worker.ready;
  worker.output.resume();
  worker.error.resume();
  await worker.launch({
    command: "opencode",
    args: ["serve", "--hostname", "127.0.0.1", "--port", "0"],
    env: {
      ...env,
      XDG_DATA_HOME: `${home}/opencode/data`,
      XDG_CONFIG_HOME: `${home}/opencode/config`,
    },
    http: {
      timeoutMs: engineLimits.approvalMs,
      readyMs: engineLimits.handshakeMs,
    },
  });

  async function catalog(model: string | null = null) {
    const [native, methods] = await Promise.all([
      worker.request<{ all: NativeProvider[]; connected: string[] }>(
        "/provider",
      ),
      worker.request<Record<string, AccountMethod[]>>("/provider/auth"),
    ]);
    const connected = new Set(native.connected);
    const models: EngineModel[] = native.all
      .filter((provider) => connected.has(provider.id))
      .flatMap((provider) =>
        Object.values(provider.models)
          .filter((item) => item.status !== "deprecated")
          .map((item) => ({
            id: `${provider.id}/${item.id}`,
            name: item.name,
          })),
      );
    return {
      providers: native.all.map((provider) => ({
        id: provider.id,
        name: provider.name,
        connected: connected.has(provider.id),
        methods: methods[provider.id]?.length
          ? (methods[provider.id] ?? [])
          : [{ type: "api" as const, label: "API 密钥" }],
      })),
      models,
      authenticated: model
        ? models.some((item) => item.id === model)
        : models.length > 0,
    };
  }

  async function provider(id: string) {
    const item = (await catalog()).providers.find((item) => item.id === id);
    if (!item) throw new Error("此服务商不可用。请重新选择。");
    return item;
  }

  return {
    catalog,
    async login(id: string, method: number, inputs?: Record<string, string>) {
      const item = await provider(id);
      if (item.methods[method]?.type !== "oauth")
        throw new Error("此连接方式不可用。请重新选择。");
      const result = await worker.request<Authorization | null>(
        `/provider/${encodeURIComponent(id)}/oauth/authorize`,
        "POST",
        { method, inputs },
      );
      if (!result || !["auto", "code"].includes(result.method))
        throw new Error("没有取得登录地址。请重试。");
      const url = new URL(result.url);
      if (url.protocol !== "https:" || url.username || url.password)
        throw new Error("登录地址不可用。请重试。");
      return result;
    },
    async complete(id: string, method: number, code?: string) {
      const result = await worker.request<boolean>(
        `/provider/${encodeURIComponent(id)}/oauth/callback`,
        "POST",
        { method, code },
      );
      if (!result) throw new Error("登录未完成。请重试。");
    },
    async key(id: string, key: string | null) {
      await provider(id);
      await worker.request(
        `/auth/${encodeURIComponent(id)}`,
        key ? "PUT" : "DELETE",
        key ? { type: "api", key } : undefined,
      );
    },
  };
}
