import { EventEmitter, on } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "@earendil-works/chord/context";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import { Connection, nodePlatform } from "@earendil-works/pi-env";
import { WorkProcess } from "../harness/process.ts";
import type { ProductResult, ProductTool } from "../harness/types.ts";
import type { RuntimeConfig } from "../runtime/config.ts";
import { Workspace } from "../workspace.ts";
import { ControllerComputer } from "./controller.ts";
import { DockerComputer } from "./docker.ts";
import type { ComputerDriver } from "./driver.ts";
import { SandboxWorkspace } from "./workspace.ts";

export type ComputerStatus = {
  id: string;
  kind: "process" | "docker" | "controller";
  deployment: "native" | "container";
  state: "running" | "stopped" | "missing" | "unavailable";
  os: string | null;
  arch: string | null;
  directory: string;
  boundary: "host" | "application" | "sandbox";
  network: "host" | "none" | "restricted" | "web";
  error: string | null;
};

export class Computer {
  readonly config: RuntimeConfig;
  private readonly driver: ComputerDriver | undefined;
  private readonly environments = new Map<
    number,
    Promise<Workspace | SandboxWorkspace>
  >();
  private readonly connections = new Map<number, Connection>();
  private readonly processes = new Set<WorkProcess>();
  private pending: Promise<unknown> = Promise.resolve();
  private changing = false;
  private readonly events = new EventEmitter();
  private remote: { platform: string; arch: string } | undefined;

  constructor(config: RuntimeConfig) {
    this.config = config;
    if (config.computer.kind === "docker")
      this.driver = new DockerComputer(config.computer);
    if (config.computer.kind === "controller")
      this.driver = new ControllerComputer(config.computer);
  }

  async bind() {
    const filename = join(this.config.dataDir, "computer.json");
    const config = this.config.computer;
    const binding =
      config.kind === "process"
        ? { kind: config.kind, deployment: this.config.deployment }
        : this.driver?.binding;
    try {
      const previous = JSON.parse(await readFile(filename, "utf8"));
      if (JSON.stringify(previous) !== JSON.stringify(binding))
        throw new Error(
          "执行目标已改变。请停止 Domos，备份工作文件并确认迁移，再移除 computer.json 后启动。",
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await writeFile(filename, JSON.stringify(binding), { flag: "wx" });
    }
  }

  async workspace(botId: number, context: Context) {
    if (this.changing)
      throw new Error("工作电脑正在切换运行状态。请稍后重试。");
    if (!Number.isSafeInteger(botId) || botId < 1)
      throw new Error("Invalid Bot ID");
    const existing = this.environments.get(botId);
    if (existing) return existing;
    const created = this.createWorkspace(botId, context);
    this.environments.set(botId, created);
    void created.catch(() => {
      if (this.environments.get(botId) === created)
        this.environments.delete(botId);
    });
    return created;
  }

  async process(
    botId: number,
    tools: ProductTool[],
    invoke: (
      callId: string,
      name: string,
      args: Record<string, unknown>,
      signal: AbortSignal,
    ) => Promise<ProductResult>,
    context: Context,
  ) {
    const workspace = await this.workspace(botId, context);
    const command = this.driver
      ? await this.driver.process?.(botId)
      : [
          process.execPath,
          process.env.DOMOS_WORKER_ENTRY ??
            fileURLToPath(new URL("../harness/worker.mjs", import.meta.url)),
        ];
    if (!command) throw new Error("工作电脑需要更新，才能运行所选引擎。");
    const home = this.driver
      ? posix.join(this.driver.directory, ".domos", "engines")
      : join(this.config.dataDir, "engines");
    const worker = new WorkProcess(
      command,
      { cwd: workspace.cwd, home },
      tools,
      invoke,
    );
    this.processes.add(worker);
    void worker.closed.then(() => this.processes.delete(worker));
    return worker;
  }

  private async createWorkspace(botId: number, context: Context) {
    if (!this.driver) {
      const cwd = join(
        this.config.dataDir,
        "agent.sqlite.files",
        String(botId),
        "workspace",
      );
      await mkdir(cwd, { recursive: true });
      const env = new Workspace({ cwd });
      return env;
    }
    let connection = this.connections.get(botId);
    if (!connection) {
      const driver = this.driver;
      connection = new Connection({
        command: async () => {
          if ((await driver.inspect()) !== "running")
            throw new Error("工作电脑未启动。请在电脑详情中启动。");
          await driver.checkNetwork();
          return driver.daemon();
        },
      });
      this.connections.set(botId, connection);
    }
    const remote = await connection.info();
    const info = nodePlatform(remote);
    if (info.platform !== "linux") throw new Error("工作沙箱必须运行 Linux。");
    this.remote = info;
    this.events.emit("change");
    const env = new SandboxWorkspace(
      {
        connection,
        id: `domos:${this.driver.config.id}`,
        cwd: posix.join(this.driver.directory, "bots", String(botId)),
      },
      remote.tmpdir,
    );
    getOrThrow(await env.createDir(env.cwd, { recursive: true }, context));
    const timeout = this.driver.config.timeoutSeconds;
    const exec = env.exec.bind(env);
    env.exec = (command, options, ctx) => {
      if (this.changing) throw new Error("工作电脑正在切换运行状态。");
      return exec(
        command,
        { ...options, timeout: Math.min(options?.timeout ?? timeout, timeout) },
        ctx,
      );
    };
    return env;
  }

  async status(): Promise<ComputerStatus> {
    const base = { deployment: this.config.deployment, error: null };
    if (!this.driver)
      return {
        ...base,
        id: "process",
        kind: "process",
        state: "running",
        os: `${platform()} ${release()}`,
        arch: arch(),
        directory: join(this.config.dataDir, "agent.sqlite.files"),
        boundary:
          this.config.deployment === "container" ? "application" : "host",
        network: "host",
      };
    let state: ComputerStatus["state"];
    let error: string | null = null;
    try {
      state = await this.driver.inspect();
      if (state === "running") await this.driver.checkNetwork();
    } catch (cause) {
      state = "unavailable";
      error = cause instanceof Error ? cause.message : "工作电脑状态不可用。";
    }
    return {
      ...base,
      id: this.driver.config.id,
      kind: this.config.computer.kind,
      state,
      os: this.remote?.platform ?? null,
      arch: this.remote?.arch ?? null,
      directory: this.driver.directory,
      boundary: "sandbox",
      network: this.driver.config.network,
      error,
    };
  }

  async *watch(signal: AbortSignal) {
    const changes = on(this.events, "change", { signal });
    try {
      yield await this.status();
      for await (const _ of changes) yield await this.status();
    } catch (error) {
      if (!signal.aborted) throw error;
    } finally {
      await changes.return?.();
    }
  }

  async manage(
    action: "start" | "stop" | "rebuild",
    context: Context,
    requireIdle: () => Promise<void>,
  ) {
    if (!this.driver) throw new Error("当前环境由 Domos 进程管理。");
    const driver = this.driver;
    const result = this.pending
      .catch(() => {})
      .then(async () => {
        this.changing = true;
        try {
          await requireIdle();
          await this.close(context);
          await driver[action]();
          return await this.status();
        } finally {
          this.changing = false;
          this.events.emit("change");
        }
      });
    this.pending = result;
    return result;
  }

  async close(context: Context) {
    await Promise.all([...this.processes].map((worker) => worker.close()));
    const environments = await Promise.allSettled(this.environments.values());
    try {
      await Promise.all(
        environments.map((result) =>
          result.status === "fulfilled"
            ? result.value.cleanup(context)
            : undefined,
        ),
      );
    } finally {
      for (const connection of this.connections.values()) connection.close();
      this.connections.clear();
      this.environments.clear();
      this.remote = undefined;
    }
  }
}
