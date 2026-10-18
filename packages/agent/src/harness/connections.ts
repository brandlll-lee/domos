import { stripVTControlCharacters } from "node:util";
import type { Context } from "@earendil-works/chord/context";
import type { EngineExecution } from "./execution.ts";
import { engineProvider } from "./providers/index.ts";
import {
  type EngineConfig,
  type EngineProcess,
  engineLimits,
} from "./types.ts";

type Login = {
  process: EngineProcess;
  state: "waiting" | "done" | "failed";
  url: string | null;
  code: string | null;
};
export class EngineConnections {
  private readonly execution: EngineExecution;
  private readonly operations = new Set<number>();
  private readonly logins = new Map<number, Login>();
  constructor(execution: EngineExecution) {
    this.execution = execution;
  }
  busy(botId: number) {
    return this.operations.has(botId);
  }

  async inspect(botId: number, config: EngineConfig, context: Context) {
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
          sessionId: null,
          instructions: "Domos connection check.",
          emit: async () => {},
          env: await this.execution.environment(config),
        });
        return {
          ready: true,
          authenticated: await session.authenticated(),
          models: await session.models(),
          message:
            config.provider === "claude" || config.provider === "opencode"
              ? "已找到账号配置。开始任务时会验证连接。"
              : "引擎已就绪。",
        };
      } finally {
        await worker.close();
      }
    });
  }

  async key(config: EngineConfig, key: string | null) {
    const store = this.execution.credentials;
    if (!store || config.provider === "pi")
      throw new Error("请在模型设置中连接账号。");
    const id = `domos-engine:${config.provider}`;
    if (key) await store.modify(id, async () => ({ type: "api_key", key }));
    else await store.delete(id);
  }

  async install(botId: number, config: EngineConfig, context: Context) {
    if (config.provider === "pi") return;
    return this.exclusive(botId, async () => {
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

  async login(botId: number, config: EngineConfig, context: Context) {
    if (config.provider !== "codex")
      throw new Error("请选择密钥连接，或使用工作电脑中已登录的账号。");
    if (this.operations.has(botId)) throw new Error("请先完成当前连接操作。");
    this.operations.add(botId);
    let worker: EngineProcess | undefined;
    try {
      worker = await this.execution.computers.process(
        botId,
        [],
        async () => {
          throw new Error("工具不可用。");
        },
        context,
      );
      const ready = await worker.ready;
      const login: Login = {
        process: worker,
        state: "waiting",
        url: null,
        code: null,
      };
      this.logins.set(botId, login);
      let output = "";
      const collect = (chunk: Buffer) => {
        output = (output + stripVTControlCharacters(chunk.toString())).slice(
          -8000,
        );
        const url = output.match(
          /https:\/\/auth\.openai\.com\/[a-zA-Z0-9_/-]+/,
        );
        const code = output.match(/\b[A-Z0-9]{4,8}-[A-Z0-9]{4,8}\b/);
        if (url) login.url = url[0];
        if (code) login.code = code[0];
      };
      worker.output.on("data", collect);
      worker.error.on("data", collect);
      const timer = setTimeout(() => {
        void login.process.close();
      }, engineLimits.approvalMs);
      timer.unref();
      await worker.launch({
        command: "codex",
        args: [...(engineProvider(config.provider).login ?? [])],
        env: { CODEX_HOME: `${ready.home}/codex` },
      });
      void worker.closed.then(async ({ code }) => {
        clearTimeout(timer);
        login.state = code === 0 ? "done" : "failed";
        login.code = null;
        login.url = null;
        this.operations.delete(botId);
        await login.process.close();
      });
      return this.loginState(botId);
    } catch (error) {
      this.operations.delete(botId);
      await worker?.close();
      throw error;
    }
  }

  loginState(botId: number) {
    const login = this.logins.get(botId);
    return login
      ? { state: login.state, url: login.url, code: login.code }
      : null;
  }
  async cancelLogin(botId: number) {
    const login = this.logins.get(botId);
    if (login?.state === "waiting") await login.process.close();
    this.logins.delete(botId);
  }
  private async exclusive<T>(botId: number, action: () => Promise<T>) {
    if (this.operations.has(botId)) throw new Error("请先完成当前连接操作。");
    this.operations.add(botId);
    try {
      return await action();
    } finally {
      this.operations.delete(botId);
    }
  }
}
