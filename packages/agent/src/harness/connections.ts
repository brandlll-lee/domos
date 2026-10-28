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
  private readonly installations = new Set<string>();
  private readonly logins: EngineLogins;
  private readonly catalogs = new Map<
    string,
    {
      computerId: string | null;
      provider: EngineConfig["provider"];
      model: string | null;
      options: string;
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
    const cached =
      this.catalogs.get(
        `${botId}:${config.provider}:${config.command ?? ""}:${JSON.stringify(config.args ?? [])}`,
      ) ??
      [...this.catalogs.entries()].find(
        ([key, entry]) =>
          key.startsWith(`${botId}:${config.provider}:`) &&
          entry.value?.path === config.command &&
          entry.computerId === computerId,
      )?.[1];
    return cached?.computerId === computerId ? (cached.value ?? null) : null;
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
      const command = selected.command ?? "";
      const cached = this.catalogs.get(
        `${botId}:${id}:${command}:${JSON.stringify(selected.args ?? [])}`,
      );
      const connection =
        cached?.computerId === computerId ? cached.value : null;
      const saved = stored?.find((item) => item.provider === id);
      return {
        id,
        name,
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
    const key = `${botId}:${config.provider}:${config.command ?? ""}:${JSON.stringify(config.args ?? [])}`;
    const computerId = await this.execution.computers.computerId(
      botId,
      context,
    );
    const cached = this.catalogs.get(key);
    if (
      cached?.computerId === computerId &&
      cached.model === config.model &&
      cached.options === JSON.stringify(config.options ?? {}) &&
      !refresh
    )
      return cached.result;
    const entry: NonNullable<ReturnType<EngineConnections["catalogs"]["get"]>> =
      {
        computerId,
        provider: config.provider,
        model: config.model,
        options: JSON.stringify(config.options ?? {}),
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
        path: null,
        message: "这台工作电脑还未安装此引擎。",
      };
    config = { ...config, command: installation.path ?? config.command };
    let worker = await this.execution.computers.process(
      botId,
      [],
      async () => {
        throw new Error("工具不可用。");
      },
      context,
    );
    try {
      let authenticated: boolean | undefined;
      if (config.provider === "claude") {
        authenticated = await readClaudeAccount(worker, {}, config.command);
        if (!authenticated)
          return {
            ready: true,
            version: installation.version,
            path: installation.path,
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
        const account = await openOpenCodeAccount(worker, {}, config.command);
        const result = await account.catalog(config.model);
        return {
          ready: true,
          version: installation.version,
          path: installation.path,
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
          path: installation.path,
          message: "引擎已就绪。",
          ...(await provider.inspect({ process: worker, config })),
        };
      const session = await provider.open({
        process: worker,
        config,
        sessionId: null,
        instructions: "Domos connection check.",
        emit: async () => {},
      });
      const models = await session.models();
      return {
        ready: true,
        version: installation.version,
        path: installation.path,
        authenticated:
          authenticated ?? (await session.authenticated?.()) ?? false,
        models,
        controls: await session.controls?.(),
        vision:
          models.find((model) => model.id === config.model)?.images ??
          (await session.vision?.()) ??
          null,
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

  async install(botId: number, config: EngineConfig, context: Context) {
    await this.invalidate(botId, config, context);
    return this.exclusive(botId, async () => {
      if (!engineProvider(config.provider).package)
        throw new Error("请在工作电脑安装此 ACP 程序。");
      const worker = await this.execution.computers.process(
        botId,
        [],
        async () => {
          throw new Error("工具不可用。");
        },
        context,
      );
      const { home } = await worker.ready;
      const provider = engineProvider(config.provider);
      const prefix = `${home}/runtime/${provider.id}/${provider.package.slice(provider.package.lastIndexOf("@") + 1)}`;
      const command = `${prefix}/node_modules/.bin/${provider.command}`;
      const scope = `${await this.execution.computers.computerId(botId, context)}:${prefix}`;
      if (this.installations.has(scope)) {
        await worker.close();
        throw new Error("这台工作电脑正在安装此程序。请稍后再试。");
      }
      this.installations.add(scope);
      worker.output.resume();
      worker.error.resume();
      const timer = setTimeout(() => {
        void worker.close();
      }, engineLimits.approvalMs);
      timer.unref();
      try {
        if (await worker.resolve?.(command)) return { ...config, command };
        await worker.launch({
          command: "npm",
          args: [
            "install",
            "--prefix",
            prefix,
            "--no-audit",
            "--no-fund",
            engineProvider(config.provider).package,
          ],
        });
        if ((await worker.closed).code !== 0)
          throw new Error("安装未完成。请检查工作电脑的网络和磁盘空间。");
        return {
          ...config,
          command,
        };
      } finally {
        this.installations.delete(scope);
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
      const command = config.command || engineProvider(config.provider).command;
      const path = worker.resolve ? await worker.resolve(command) : command;
      if (!path) return { available: false, version: null, path: null };
      if (config.provider === "acp")
        return { available: true, version: null, path };
      await worker.launch({
        command: path,
        args: ["--version"],
      });
      const result = await worker.closed;
      if (result.error === "ENOENT")
        return { available: false, version: null, path: null };
      if (result.code !== 0)
        throw new Error("引擎未能启动。请检查程序后重试。");
      return {
        available: true,
        path,
        version: output.match(/\d+\.\d+\.\d+(?:-[\w.-]+)?/)?.[0] ?? null,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { available: false, version: null, path: null };
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
