import { resolve } from "node:path";
import { parseConfig } from "@domos/agent/config";
import {
  type InstallProgress,
  prepareLocalInstallation,
  prepareWorkImages,
  type Release,
  waitForService,
  workComputer,
  writeConfiguration,
} from "@domos/hosting/install";
import { type UtilityProcess, utilityProcess } from "electron";

export class LocalHost {
  private readonly children: UtilityProcess[] = [];
  private pending: Promise<unknown> = Promise.resolve();
  private starting?: Promise<{ origin: string; url: string }>;
  private server?: UtilityProcess;
  readonly directory: string;
  readonly release: Release;
  readonly runtimeDirectory: string;

  constructor(directory: string, release: Release, runtimeDirectory: string) {
    this.directory = directory;
    this.release = release;
    this.runtimeDirectory = runtimeDirectory;
  }

  get running() {
    return this.children.length > 0;
  }

  start(progress: (value: InstallProgress) => void, signal: AbortSignal) {
    if (this.starting) return this.starting;
    this.starting = this.startNow(progress, signal).finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async startNow(
    progress: (value: InstallProgress) => void,
    signal: AbortSignal,
  ) {
    await this.pending;
    await prepareWorkImages(this.release, progress, signal);
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
    const expected = config.computer.kind === "controller" ? 2 : 1;
    if (this.children.length !== expected) {
      await this.stopChildren();
      progress({ phase: "starting", message: "正在启动本机后台…" });
      const childEnv: NodeJS.ProcessEnv = {
        ...process.env,
        DOMOS_CONFIG: prepared.configFile,
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
          { env: childEnv, stdio: "pipe" },
        );
        child.stdout?.resume();
        child.stderr?.resume();
        this.children.push(child);
        child.once("exit", () => {
          const index = this.children.indexOf(child);
          if (index >= 0) this.children.splice(index, 1);
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
    progress({ phase: "ready", message: "本机后台已启动。" });
    return { origin, url: origin };
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
          if (message.type !== "desktop-session") return;
          cleanup();
          resolve({ token: message.token, expires: message.expires });
        };
        const timer = setTimeout(failed, 10_000);
        server.on("message", receive);
        server.once("exit", failed);
        server.postMessage("pair-desktop");
      },
    );
  }

  stop() {
    const starting = this.starting;
    this.pending = this.pending
      .catch(() => {})
      .then(async () => {
        await starting?.catch(() => {});
        await this.stopChildren();
      });
    return this.pending;
  }

  private async stopChildren() {
    for (const child of [...this.children].reverse()) {
      const exited = new Promise<void>((resolve) =>
        child.once("exit", () => resolve()),
      );
      child.postMessage("shutdown");
      const timer = setTimeout(() => child.kill(), 30_000);
      await exited;
      clearTimeout(timer);
    }
    this.children.length = 0;
  }
}
