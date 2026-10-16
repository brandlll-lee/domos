import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseConfig } from "@domos/agent/config";
import {
  type InstallProgress,
  prepareInstallation,
  type Release,
  waitForService,
  writeConfiguration,
} from "@domos/hosting/install";
import { type UtilityProcess, utilityProcess } from "electron";

export class LocalHost {
  private readonly children: UtilityProcess[] = [];
  private pending: Promise<unknown> = Promise.resolve();
  private starting?: Promise<{ origin: string; url: string }>;
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
    const prepared = await prepareInstallation(
      this.directory,
      this.release,
      progress,
      signal,
    );
    const config = parseConfig(prepared.config, prepared.configFile);
    if (config.staticDir !== this.release.staticDir) {
      const { configFile: _configFile, ...value } = config;
      await writeConfiguration(prepared.configFile, {
        ...value,
        staticDir: this.release.staticDir,
      });
    }
    const origin = config.publicUrl ?? `http://${config.host}:${config.port}`;
    if (this.children.length !== 2) {
      await this.stopChildren();
      progress({ phase: "starting", message: "正在启动后台和工作电脑…" });
      const childEnv = {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        DOMOS_CONFIG: prepared.configFile,
        DOMOS_BRIDGE_ENTRY: resolve(
          this.runtimeDirectory,
          this.release.bridgeEntry,
        ),
      };
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
      };
      try {
        start(this.release.controllerEntry, [prepared.controllerFile]);
        start(this.release.serverEntry, []);
        await waitForService(
          origin,
          AbortSignal.any([signal, AbortSignal.timeout(90_000)]),
        );
        const control = JSON.parse(
          await readFile(prepared.controllerFile, "utf8"),
        );
        const token = (await readFile(control.credentialFile, "utf8")).trim();
        const started = await fetch(
          `http://${control.host}:${control.port}/${control.computer.id}/start`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
          },
        );
        if (!started.ok) throw new Error("工作电脑未启动。请检查 Docker。");
      } catch (error) {
        await this.stopChildren();
        throw error;
      }
    }
    progress({ phase: "ready", message: "准备完成。请连接模型。" });
    let code: string | undefined;
    try {
      code = await readFile(join(this.directory, "data", "owner-code"), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return {
      origin,
      url: code ? `${origin}/#pair=${encodeURIComponent(code)}` : origin,
    };
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
