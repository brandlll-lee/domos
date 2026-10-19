import type { Context } from "@earendil-works/chord/context";
import { readClaudeAccount } from "./claude-account.ts";
import type { EngineExecution } from "./execution.ts";
import { type EngineLoginInput, EngineLogins } from "./logins.ts";
import { openOpenCodeAccount } from "./opencode-account.ts";
import { engineProvider } from "./providers/index.ts";
import { type EngineConfig, type EngineModel, engineLimits } from "./types.ts";

export class EngineConnections {
  private readonly execution: EngineExecution;
  private readonly operations = new Set<number>();
  private readonly logins: EngineLogins;
  constructor(execution: EngineExecution) {
    this.execution = execution;
    this.logins = new EngineLogins(execution);
  }
  busy(botId: number) {
    return this.operations.has(botId) || this.logins.busy(botId);
  }

  async inspect(botId: number, config: EngineConfig, context: Context) {
    return this.exclusive(botId, async () => {
      const installation = await this.installed(botId, config, context);
      if (!installation.available)
        return {
          ready: false,
          authenticated: false,
          models: [] as EngineModel[],
          version: null,
          message: "这台工作电脑还未安装此引擎。",
        };
      const worker = await this.execution.computers.process(
        botId,
        [],
        async () => {
          throw new Error("工具不可用。");
        },
        context,
      );
      try {
        const env = await this.execution.environment(config);
        if (config.provider === "claude")
          return {
            ready: true,
            version: installation.version,
            authenticated: await readClaudeAccount(worker, env),
            models: [] as EngineModel[],
            vision: null,
            message: "已检查账号。",
          };
        if (config.provider === "opencode") {
          const account = await openOpenCodeAccount(worker, env);
          const result = await account.catalog(config.model);
          return {
            ready: true,
            version: installation.version,
            authenticated: result.authenticated,
            models: result.models,
            vision:
              result.models.find((model) => model.id === config.model)
                ?.images ?? null,
            message: result.authenticated
              ? "引擎已就绪。"
              : "请连接账号或选择可用模型。",
          };
        }
        const session = await engineProvider(config.provider).open({
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
          authenticated: (await session.authenticated?.()) ?? false,
          models: await session.models(),
          vision: (await session.vision?.()) ?? null,
          message: "引擎已就绪。",
        };
      } finally {
        await worker.close();
      }
    });
  }

  async accounts(botId: number, config: EngineConfig, context: Context) {
    if (config.provider !== "opencode")
      throw new Error("此引擎不提供服务商列表。");
    return this.exclusive(botId, async () => {
      const worker = await this.execution.computers.process(
        botId,
        [],
        async () => ({ content: [] }),
        context,
      );
      try {
        return await (
          await openOpenCodeAccount(
            worker,
            await this.execution.environment(config),
          )
        ).catalog(config.model);
      } finally {
        await worker.close();
      }
    });
  }

  async key(
    botId: number,
    config: EngineConfig,
    key: string | null,
    context: Context,
    providerId?: string,
  ) {
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
    });
  }

  async install(botId: number, config: EngineConfig, context: Context) {
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
