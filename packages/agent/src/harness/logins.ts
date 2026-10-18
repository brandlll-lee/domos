import { stripVTControlCharacters } from "node:util";
import type { Context } from "@earendil-works/chord/context";
import { readClaudeAccount } from "./claude-account.ts";
import type { EngineExecution } from "./execution.ts";
import { openOpenCodeAccount } from "./opencode-account.ts";
import { engineProvider } from "./providers/index.ts";
import {
  type EngineConfig,
  type EngineProcess,
  engineLimits,
} from "./types.ts";

export type EngineLoginInput = {
  providerId?: string;
  method?: number;
  inputs?: Record<string, string>;
};
export type EngineLoginState = {
  state: "waiting" | "done" | "failed";
  url: string | null;
  code: string | null;
  prompt: string | null;
  instructions: string | null;
};
type Login = {
  worker: EngineProcess;
  status: EngineLoginState;
  scope: string;
  timer: NodeJS.Timeout;
  answer?: (code: string) => Promise<void>;
  submitting: boolean;
};
const loginHosts = {
  codex: ["auth.openai.com"],
  claude: [
    "claude.com",
    "claude.ai",
    "console.anthropic.com",
    "platform.claude.com",
  ],
};

export class EngineLogins {
  private readonly execution: EngineExecution;
  private readonly flows = new Map<number, Login>();
  private readonly scopes = new Set<string>();
  constructor(execution: EngineExecution) {
    this.execution = execution;
  }
  busy(botId: number) {
    return this.flows.get(botId)?.status.state === "waiting";
  }
  state(botId: number) {
    const flow = this.flows.get(botId);
    return flow ? { ...flow.status } : null;
  }
  async start(
    botId: number,
    config: EngineConfig,
    input: EngineLoginInput,
    context: Context,
  ) {
    if (config.provider === "pi") throw new Error("请在模型设置中连接账号。");
    const scope = `${await this.execution.computers.computerId(botId, context)}:${config.provider}`;
    if (this.scopes.has(scope))
      throw new Error("这台工作电脑正在连接此账号。请稍后再试。");
    this.scopes.add(scope);
    let flow: Login | undefined;
    try {
      const worker = await this.execution.computers.process(
        botId,
        [],
        async () => {
          throw new Error("工具不可用。");
        },
        context,
      );
      flow = {
        worker,
        scope,
        status: {
          state: "waiting",
          url: null,
          code: null,
          prompt: null,
          instructions: null,
        },
        timer: setTimeout(
          () => void this.finish(botId, false, flow),
          engineLimits.approvalMs,
        ),
        submitting: false,
      };
      flow.timer.unref();
      this.flows.set(botId, flow);
      if (config.provider === "opencode")
        await this.openCode(botId, flow, input);
      else await this.cli(botId, flow, config, context);
      return this.state(botId);
    } catch (error) {
      if (flow) await this.finish(botId, false, flow);
      else this.scopes.delete(scope);
      throw error;
    }
  }
  async answer(botId: number, code: string) {
    const flow = this.flows.get(botId);
    if (flow?.status.state !== "waiting" || !flow.answer || flow.submitting)
      throw new Error("这次登录已结束。请重新登录。");
    if (!code.trim() || /[\r\n]/.test(code))
      throw new Error("请输入登录页面显示的代码。");
    flow.submitting = true;
    try {
      await flow.answer(code.trim());
      flow.status.prompt = null;
    } catch {
      await this.finish(botId, false, flow);
      throw new Error("登录未完成。请重新登录。");
    } finally {
      flow.submitting = false;
    }
  }
  async cancel(botId: number) {
    await this.finish(botId, false);
    this.flows.delete(botId);
  }
  private async finish(botId: number, success: boolean, expected?: Login) {
    const flow = this.flows.get(botId);
    if (flow?.status.state !== "waiting" || (expected && flow !== expected))
      return;
    flow.status = {
      state: success ? "done" : "failed",
      url: null,
      code: null,
      prompt: null,
      instructions: null,
    };
    clearTimeout(flow.timer);
    try {
      await flow.worker.close();
    } finally {
      this.scopes.delete(flow.scope);
    }
  }
  private async openCode(botId: number, flow: Login, input: EngineLoginInput) {
    if (!input.providerId || input.method === undefined)
      throw new Error("请选择服务商和连接方式。");
    const { providerId, method } = input;
    const account = await openOpenCodeAccount(flow.worker);
    const authorization = await account.login(providerId, method, input.inputs);
    Object.assign(flow.status, {
      url: authorization.url,
      instructions: authorization.instructions,
    });
    const complete = async (code?: string) => {
      await account.complete(providerId, method, code);
      if (flow.status.state !== "waiting") return;
      if (providerId === "openai")
        await this.execution.credentials?.delete("domos-engine:opencode");
      await this.finish(botId, true, flow);
    };
    if (authorization.method === "code") {
      flow.status.prompt = "粘贴登录页面显示的代码";
      flow.answer = complete;
    } else void complete().catch(() => this.finish(botId, false, flow));
    void flow.worker.closed.then(() => this.finish(botId, false, flow));
  }
  private async cli(
    botId: number,
    flow: Login,
    config: EngineConfig,
    context: Context,
  ) {
    const provider = config.provider as "codex" | "claude";
    const { home } = await flow.worker.ready;
    let output = "";
    const collect = (chunk: Buffer) => {
      output = (output + stripVTControlCharacters(chunk.toString())).slice(
        -engineLimits.outputCharacters,
      );
      for (const line of output.split(/\r?\n/).slice(0, -1)) {
        for (const match of line.matchAll(/https:\/\/[^\s<>]+/g)) {
          try {
            const url = new URL(match[0].replace(/[),.;]+$/, ""));
            if (
              !url.username &&
              !url.password &&
              loginHosts[provider].some(
                (host) =>
                  url.hostname === host || url.hostname.endsWith(`.${host}`),
              )
            )
              flow.status.url = url.href;
          } catch {}
        }
      }
      if (provider === "codex")
        flow.status.code =
          output.match(/\b[A-Z0-9]{4,8}-[A-Z0-9]{4,8}\b/)?.[0] ?? null;
      else if (/paste[^\n]*code|enter[^\n]*code/i.test(output))
        flow.status.prompt = "粘贴登录页面显示的代码";
    };
    flow.worker.output.on("data", collect);
    flow.worker.error.on("data", collect);
    flow.answer = async (code) => {
      if (provider !== "claude") throw new Error("请在浏览器中输入代码。");
      await new Promise<void>((resolve, reject) =>
        flow.worker.input.write(`${code}\n`, (error) =>
          error ? reject(error) : resolve(),
        ),
      );
    };
    await flow.worker.launch({
      command: engineProvider(provider).command,
      args: [...(engineProvider(provider).login ?? [])],
      env:
        provider === "claude"
          ? { CLAUDE_CONFIG_DIR: `${home}/claude` }
          : { CODEX_HOME: `${home}/codex` },
    });
    void flow.worker.closed
      .then(async ({ code }) => {
        if (flow.status.state !== "waiting") return;
        let success = code === 0;
        if (success && provider === "claude") {
          const worker = await this.execution.computers.process(
            botId,
            [],
            async () => ({ content: [] }),
            context,
          );
          success = await readClaudeAccount(worker);
        }
        if (flow.status.state !== "waiting") return;
        if (success)
          await this.execution.credentials?.delete(`domos-engine:${provider}`);
        await this.finish(botId, success, flow);
      })
      .catch(() => this.finish(botId, false, flow));
  }
}
