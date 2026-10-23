import type { Context } from "@earendil-works/chord/context";
import { readClaudeAccount } from "./claude-account.ts";
import type { EngineExecution } from "./execution.ts";
import { type EngineLoginInput, EngineLogins } from "./logins.ts";
import type { EngineModelCatalog } from "./model-catalog.ts";
import { openOpenCodeAccount } from "./opencode-account.ts";
import { engineProvider, providers } from "./providers/index.ts";
import { type EngineConfig, type EngineModel, engineLimits } from "./types.ts";

export class EngineConnections {
  private readonly execution: EngineExecution;
  private readonly modelCatalog?: EngineModelCatalog;
  private readonly operations = new Set<number>();
  private readonly logins: EngineLogins;
  private readonly catalogs = new Map<
    string,
    {
      computerId: string | null;
      provider: EngineConfig["provider"];
      model: string | null;
      accountSource: EngineConfig["accountSource"];
      value?: Awaited<ReturnType<EngineConnections["discover"]>>;
      result: Promise<Awaited<ReturnType<EngineConnections["discover"]>>>;
    }
  >();
  constructor(execution: EngineExecution, modelCatalog?: EngineModelCatalog) {
    this.execution = execution;
    this.modelCatalog = modelCatalog;
    this.logins = new EngineLogins(execution);
  }
  busy(botId: number) {
    return this.operations.has(botId) || this.logins.busy(botId);
  }

  async snapshot(botId: number, config: EngineConfig, context: Context) {
    const computerId = await this.execution.computers.computerId(
      botId,
      context,
    );
    const cached = this.catalogs.get(
      `${botId}:${config.provider}:${config.accountSource ?? "managed"}`,
    );
    return cached?.computerId === computerId &&
      (cached.accountSource ?? "managed") ===
        (config.accountSource ?? "managed")
      ? (cached.value ?? null)
      : null;
  }

  async catalog(botId: number, context: Context, config?: EngineConfig) {
    const computerId = await this.execution.computers.computerId(
      botId,
      context,
    );
    const stored = await this.modelCatalog?.read(botId, computerId, context);
    return [...providers.values()].map(({ id, name }) => {
      const selected =
        config?.provider === id ? config : { provider: id, model: null };
      const accountSource = selected.accountSource ?? "managed";
      const cached = this.catalogs.get(`${botId}:${id}:${accountSource}`);
      const connection =
        cached?.computerId === computerId &&
        (cached.accountSource ?? "managed") === accountSource
          ? cached.value
          : null;
      const saved = stored?.find(
        (item) => item.provider === id && item.accountSource === accountSource,
      );
      return {
        id,
        name,
        accountSource,
        version: connection?.version ?? saved?.version ?? null,
        models: connection?.models ?? saved?.models ?? [],
      };
    });
  }

  async inspect(
    botId: number,
    config: EngineConfig,
    context: Context,
    refresh = false,
  ) {
    const key = `${botId}:${config.provider}:${config.accountSource ?? "managed"}`;
    const computerId = await this.execution.computers.computerId(
      botId,
      context,
    );
    const cached = this.catalogs.get(key);
    if (
      cached?.computerId === computerId &&
      cached.model === config.model &&
      (cached.accountSource ?? "managed") ===
        (config.accountSource ?? "managed") &&
      !refresh
    )
      return cached.result;
    const entry: NonNullable<ReturnType<EngineConnections["catalogs"]["get"]>> =
      {
        computerId,
        provider: config.provider,
        model: config.model,
        accountSource: config.accountSource,
        result: this.discover(botId, config, context),
      };
    this.catalogs.set(key, entry);
    try {
      const result = await entry.result;
      entry.value = result;
      if (this.catalogs.get(key) === entry && result.ready)
        await this.modelCatalog?.save(
          botId,
          computerId,
          config,
          { models: result.models, version: result.version },
          context,
        );
      return result;
    } catch (error) {
      if (this.catalogs.get(key) === entry) this.catalogs.delete(key);
      throw error;
    }
  }

  private async discover(
    botId: number,
    config: EngineConfig,
    context: Context,
  ) {
    const installation = await this.installed(botId, config, context);
    if (!installation.available)
      return {
        ready: false,
        authenticated: false,
        models: [] as EngineModel[],
        version: null,
        message: "这台工作电脑还未安装此引擎。",
      };
    let worker = await this.execution.computers.process(
      botId,
      [],
      async () => {
        throw new Error("工具不可用。");
      },
      context,
    );
    try {
      const env = await this.execution.environment(config);
      let authenticated: boolean | undefined;
      if (config.provider === "claude") {
        authenticated = await readClaudeAccount(
          worker,
          env,
          config.accountSource,
        );
        if (!authenticated)
          return {
            ready: true,
            version: installation.version,
            authenticated,
            models: [] as EngineModel[],
            vision: null,
            message: "请连接账号。",
          };
        worker = await this.execution.computers.process(
          botId,
          [],
          async () => {
            throw new Error("工具不可用。");
          },
          context,
        );
      }
      if (config.provider === "opencode") {
        const account = await openOpenCodeAccount(
          worker,
          env,
          config.accountSource,
        );
        const result = await account.catalog(config.model);
        return {
          ready: true,
          version: installation.version,
          authenticated: result.authenticated,
          models: result.models,
          accounts: result,
          vision:
            result.models.find((model) => model.id === config.model)?.images ??
            null,
          message: result.authenticated
            ? "引擎已就绪。"
            : "请连接账号或选择可用模型。",
        };
      }
      const provider = engineProvider(config.provider);
      if (provider.inspect)
        return {
          ready: true,
          version: installation.version,
          message: "引擎已就绪。",
          ...(await provider.inspect({ process: worker, config, env })),
        };
      const session = await provider.open({
        process: worker,
        config,
        sessionId: null,
        instructions: "Domos connection check.",
        emit: async () => {},
        env,
      });
      return {
        ready: true,
        version: installation.version,
        authenticated:
          authenticated ?? (await session.authenticated?.()) ?? false,
        models: await session.models(),
        controls: await session.controls?.(),
        vision: (await session.vision?.()) ?? null,
        message: "引擎已就绪。",
      };
    } finally {
      await worker.close();
    }
  }

  async controls(
    botId: number,
    config: EngineConfig,
    sessionId: string | null,
    context: Context,
  ) {
    const connection = await this.inspect(botId, config, context);
    if ("controls" in connection && connection.controls)
      return connection.controls;
    if (!connection.ready) throw new Error(connection.message);
    return this.exclusive(botId, async () => {
      const worker = await this.execution.computers.process(
        botId,
        [],
        async () => {
          throw new Error("工具不可用。");
        },
        context,
      );
      try {
        const session = await engineProvider(config.provider).open({
          process: worker,
          config,
          sessionId,
          instructions: "Domos configuration check.",
          emit: async () => {},
          env: await this.execution.environment(config),
        });
        return (
          (await session.controls?.()) ?? {
            options: [],
            commands: [],
            compact: false,
          }
        );
      } finally {
        await worker.close();
      }
    });
  }

  async accounts(botId: number, config: EngineConfig, context: Context) {
    if (config.provider !== "opencode")
      throw new Error("此引擎不提供服务商列表。");
    const connection = await this.inspect(botId, config, context);
    if (!("accounts" in connection) || !connection.accounts)
      throw new Error("请先安装 OpenCode。");
    return connection.accounts;
  }

  async key(
    botId: number,
    config: EngineConfig,
    key: string | null,
    context: Context,
    providerId?: string,
  ) {
    if (config.accountSource === "native")
      throw new Error("请在工作电脑的 CLI 中管理原生账号。");
    await this.invalidate(botId, config, context);
    return this.exclusive(botId, async () => {
      if (config.provider === "opencode") {
        if (!providerId) throw new Error("请选择服务商。");
        const worker = await this.execution.computers.process(
          botId,
          [],
          async () => ({ content: [] }),
          context,
        );
        try {
          const account = await openOpenCodeAccount(
            worker,
            await this.execution.environment(config),
          );
          await account.key(providerId, key);
          if (providerId === "openai")
            await this.execution.credentials?.delete("domos-engine:opencode");
        } finally {
          await worker.close();
        }
        return;
      }
      const store = this.execution.credentials;
      if (!store || config.provider === "pi")
        throw new Error("请在模型设置中连接账号。");
      const id = `domos-engine:${config.provider}`;
      if (key) await store.modify(id, async () => ({ type: "api_key", key }));
      else await store.delete(id);
      for (const [key, entry] of this.catalogs)
        if (entry.provider === config.provider) this.catalogs.delete(key);
    });
  }

  async install(botId: number, config: EngineConfig, context: Context) {
    await this.invalidate(botId, config, context);
    if (config.provider === "pi") return;
    return this.exclusive(botId, async () => {
      if ((await this.installed(botId, config, context)).available) return;
      const worker = await this.execution.computers.process(
        botId,
        [],
        async () => {
          throw new Error("工具不可用。");
        },
        context,
      );
      const { home } = await worker.ready;
      worker.output.resume();
      worker.error.resume();
      const timer = setTimeout(() => {
        void worker.close();
      }, engineLimits.approvalMs);
      timer.unref();
      try {
        await worker.launch({
          command: "npm",
          args: [
            "install",
            "--prefix",
            `${home}/runtime`,
            "--no-audit",
            "--no-fund",
            engineProvider(config.provider).package,
          ],
        });
        if ((await worker.closed).code !== 0)
          throw new Error("安装未完成。请检查工作电脑的网络和磁盘空间。");
      } finally {
        clearTimeout(timer);
        await worker.close();
      }
    });
  }

  async login(
    botId: number,
    config: EngineConfig,
    context: Context,
    input: EngineLoginInput = {},
  ) {
    if (config.accountSource === "native")
      throw new Error("请在工作电脑的 CLI 中管理原生账号。");
    await this.invalidate(botId, config, context);
    return this.exclusive(botId, () =>
      this.logins.start(botId, config, input, context),
    );
  }

  loginState(botId: number) {
    return this.logins.state(botId);
  }
  async cancelLogin(botId: number) {
    await this.logins.cancel(botId);
  }
  async answerLogin(botId: number, code: string) {
    await this.logins.answer(botId, code);
  }
  private async invalidate(
    botId: number,
    config: EngineConfig,
    context: Context,
  ) {
    const computerId = await this.execution.computers.computerId(
      botId,
      context,
    );
    await this.modelCatalog?.invalidate(computerId, config, context);
    for (const [key, entry] of this.catalogs)
      if (entry.computerId === computerId && entry.provider === config.provider)
        this.catalogs.delete(key);
  }
  private async installed(
    botId: number,
    config: EngineConfig,
    context: Context,
  ) {
    if (config.provider === "pi") return { available: true, version: null };
    const worker = await this.execution.computers.process(
      botId,
      [],
      async () => {
        throw new Error("工具不可用。");
      },
      context,
    );
    let output = "";
    worker.output.on("data", (chunk) => {
      output = (output + chunk.toString()).slice(
        -engineLimits.outputCharacters,
      );
    });
    worker.error.resume();
    const timer = setTimeout(
      () => void worker.close(),
      engineLimits.handshakeMs,
    );
    timer.unref();
    try {
      await worker.launch({
        command: engineProvider(config.provider).command,
        args: ["--version"],
        accountSource: config.accountSource,
      });
      const result = await worker.closed;
      if (result.error === "ENOENT") return { available: false, version: null };
      if (result.code !== 0)
        throw new Error("引擎未能启动。请检查程序后重试。");
      return {
        available: true,
        version: output.match(/\d+\.\d+\.\d+(?:-[\w.-]+)?/)?.[0] ?? null,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { available: false, version: null };
      throw error;
    } finally {
      clearTimeout(timer);
      await worker.close();
    }
  }
  private async exclusive<T>(botId: number, action: () => Promise<T>) {
    if (this.busy(botId)) throw new Error("请先完成当前连接操作。");
    this.operations.add(botId);
    try {
      return await action();
    } finally {
      this.operations.delete(botId);
    }
  }
}
