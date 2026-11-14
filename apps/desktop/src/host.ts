import { resolve } from "node:path";
import { parseConfig } from "@domos/agent/config";
import {
  type InstallProgress,
  prepareLocalInstallation,
  type Release,
  waitForService,
  workComputer,
  writeConfiguration,
} from "@domos/hosting/install";
import { type UtilityProcess, utilityProcess } from "electron";
import { diagnostics, errorTrace } from "./diagnostics.ts";

export type ServiceState =
  | "starting"
  | "ready"
  | "recovering"
  | "stopped"
  | "failed";

export class LocalHost {
  private readonly children: UtilityProcess[] = [];
  private pending: Promise<unknown> = Promise.resolve();
  private starting?: Promise<{ origin: string; url: string }>;
  private server?: UtilityProcess;
  private operation?: AbortController;
  private startup?: AbortController;
  private wanted = false;
  private stoppingChildren = false;
  private recoveries: number[] = [];
  private recovery?: Promise<void>;
  private endpoint?: { origin: string; url: string };
  private readonly record: ReturnType<typeof diagnostics>;
  state: ServiceState = "stopped";
  recoveryEnabled = true;
  readonly directory: string;
  readonly release: Release;
  readonly runtimeDirectory: string;

  constructor(
    directory: string,
    release: Release,
    runtimeDirectory: string,
    private readonly changed: (state: ServiceState) => void = () => {},
  ) {
    this.directory = directory;
    this.release = release;
    this.runtimeDirectory = runtimeDirectory;
    this.record = diagnostics(directory);
  }

  get running() {
    return this.state === "ready" && this.server !== undefined;
  }

  private publish(state: ServiceState) {
    this.state = state;
    this.record({ event: "state", state });
    this.changed(state);
  }

  start(progress: (value: InstallProgress) => void, signal: AbortSignal) {
    if (this.starting) return this.starting;
    this.wanted = true;
    this.recoveries = [];
    const operation = new AbortController();
    this.startup = operation;
    this.starting = (async () => {
      await this.recovery;
      this.operation = operation;
      signal.throwIfAborted();
      operation.signal.throwIfAborted();
      if (this.running && this.endpoint) return this.endpoint;
      this.publish("starting");
      try {
        return await this.startNow(
          progress,
          AbortSignal.any([signal, operation.signal]),
        );
      } catch (error) {
        this.record({
          event: "start-failed",
          error: error instanceof Error ? error.name : "Error",
        });
        if (this.wanted) this.publish("failed");
        throw error;
      }
    })().finally(() => {
      this.starting = undefined;
      this.startup = undefined;
    });
    return this.starting;
  }

  private async startNow(
    progress: (value: InstallProgress) => void,
    signal: AbortSignal,
  ) {
    await this.pending;
    signal.throwIfAborted();
    const prepared = await prepareLocalInstallation(
      this.directory,
      this.release,
    );
    const config = parseConfig(prepared.config, prepared.configFile);
    if (config.host !== "127.0.0.1" || config.publicUrl)
      throw new Error("桌面本机后台必须仅监听回环地址。");
    if (config.staticDir !== this.release.staticDir || !config.workComputer) {
      const { configFile: _configFile, ...value } = config;
      await writeConfiguration(prepared.configFile, {
        ...value,
        staticDir: this.release.staticDir,
        workComputer: config.workComputer ?? workComputer(this.release),
      });
    }
    const origin = config.publicUrl ?? `http://${config.host}:${config.port}`;
    if (!this.running) {
      await this.stopChildren();
      signal.throwIfAborted();
      progress({ phase: "starting", message: "正在启动本机后台…" });
      const childEnv: NodeJS.ProcessEnv = {
        ...process.env,
        DOMOS_CONFIG: prepared.configFile,
        DOMOS_WORKER_ENTRY: resolve(
          this.runtimeDirectory,
          this.release.workerEntry ?? "worker.mjs",
        ),
        DOMOS_BRIDGE_ENTRY: resolve(
          this.runtimeDirectory,
          this.release.bridgeEntry,
        ),
      };
      delete childEnv.ELECTRON_RUN_AS_NODE;
      const start = (entry: string, args: string[]) => {
        const child = utilityProcess.fork(
          resolve(this.runtimeDirectory, entry),
          args,
          { env: childEnv, stdio: "pipe", serviceName: `Domos ${entry}` },
        );
        child.stdout?.resume();
        let lines = "";
        let pid: number | undefined;
        child.stderr?.on("data", (chunk: Buffer) => {
          lines = (lines + chunk.toString("utf8")).slice(-16_384);
          const entries = lines.split(/\r?\n/);
          lines = entries.pop() ?? "";
          for (const line of entries) {
            const trace = errorTrace(line);
            if (trace)
              this.record({ event: "error", entry, pid: child.pid, trace });
          }
        });
        child.once("spawn", () => {
          pid = child.pid;
          this.record({ event: "spawn", entry, pid });
        });
        child.on("error", (type, location) =>
          this.record({ event: "fatal", entry, type, location }),
        );
        this.children.push(child);
        child.once("exit", (code) => {
          this.record({
            event: "exit",
            entry,
            pid,
            code,
            expected: this.stoppingChildren || !this.wanted,
          });
          const index = this.children.indexOf(child);
          if (index >= 0) this.children.splice(index, 1);
          if (this.server === child) this.server = undefined;
          if (this.stoppingChildren || !this.wanted) return;
          this.operation?.abort(new Error("本机服务进程已退出。"));
          if (this.state === "ready") {
            if (!this.recoveryEnabled) {
              this.publish("stopped");
              return;
            }
            this.publish("recovering");
            this.recovery = this.recover().finally(() => {
              this.recovery = undefined;
            });
          }
        });
        return child;
      };
      try {
        if (config.computer.kind === "controller")
          start(this.release.controllerEntry, [prepared.controllerFile]);
        this.server = start(this.release.serverEntry, []);
        await waitForService(
          origin,
          AbortSignal.any([signal, AbortSignal.timeout(90_000)]),
        );
      } catch (error) {
        await this.stopChildren();
        throw error;
      }
    }
    signal.throwIfAborted();
    progress({ phase: "ready", message: "本机后台已启动。" });
    this.endpoint = { origin, url: origin };
    this.publish("ready");
    return this.endpoint;
  }

  private async recover() {
    try {
      for (
        let attempt = 0;
        this.wanted && this.recoveryEnabled && attempt < 2;
        attempt++
      ) {
        this.recoveries = this.recoveries.filter(
          (time) => Date.now() - time < 60_000,
        );
        if (this.recoveries.length >= 2) break;
        this.recoveries.push(Date.now());
        const operation = new AbortController();
        this.operation = operation;
        try {
          await this.startNow(() => {}, operation.signal);
          return;
        } catch (error) {
          this.record({
            event: "recovery-failed",
            error: error instanceof Error ? error.name : "Error",
          });
          if (!this.wanted) return;
        }
      }
      if (this.wanted) this.publish("failed");
    } catch {
      if (this.wanted) this.publish("failed");
    }
  }

  pair() {
    const server = this.server;
    if (!server) throw new Error("本机后台未启动。");
    return new Promise<{ token: string; expires: number }>(
      (resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          server.removeListener("message", receive);
          server.removeListener("exit", failed);
        };
        const failed = () => {
          cleanup();
          reject(new Error("桌面配对未完成。"));
        };
        const receive = (message: {
          type?: string;
          token: string;
          expires: number;
        }) => {
          if (message.type === "desktop-session-error") {
            failed();
            return;
          }
          if (message.type !== "desktop-session") return;
          cleanup();
          resolve({ token: message.token, expires: message.expires });
        };
        const timer = setTimeout(failed, 10_000);
        server.on("message", receive);
        server.once("exit", failed);
        try {
          server.postMessage("pair-desktop");
        } catch {
          failed();
        }
      },
    );
  }

  stop() {
    this.wanted = false;
    this.startup?.abort(new Error("本机服务已停止。"));
    this.operation?.abort(new Error("本机服务已停止。"));
    const starting = this.starting;
    const recovery = this.recovery;
    this.pending = this.pending
      .catch(() => {})
      .then(async () => {
        await starting?.catch(() => {});
        await recovery;
        await this.stopChildren();
        this.publish("stopped");
      });
    return this.pending;
  }

  private async stopChildren() {
    this.stoppingChildren = true;
    try {
      for (const child of [...this.children].reverse()) {
        if (!this.children.includes(child)) continue;
        const exited = new Promise<void>((resolve) =>
          child.once("exit", () => resolve()),
        );
        const timer = setTimeout(() => child.kill(), 30_000);
        try {
          child.postMessage("shutdown");
        } catch {
          child.kill();
        }
        await exited;
        clearTimeout(timer);
      }
      this.children.length = 0;
      this.server = undefined;
    } finally {
      this.stoppingChildren = false;
    }
  }
}
