import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  allocatePort,
  type InstallProgress,
  prepareWorkImages,
  type Release,
  runCommand,
  waitForService,
  workComputer,
  writeConfiguration,
} from "./install.ts";

const stackSchema = z.object({
  id: z.string().regex(/^domos-[a-f0-9]{12}$/),
  port: z.number().int().min(1).max(65535),
  directory: z.string(),
});
const sessionSchema = z.object({
  token: z.string().min(32),
  expires: z.number(),
});
const operationTimeout = 20 * 60_000;

export class LocalStack {
  readonly directory: string;
  readonly release: Release;
  private readonly execute: typeof runCommand;
  private readonly ready: typeof waitForService;
  private starting?: Promise<{ origin: string; url: string }>;
  private pending: Promise<unknown> = Promise.resolve();
  private active = false;
  private origin?: string;

  constructor(
    directory: string,
    release: Release,
    execute = runCommand,
    ready = waitForService,
  ) {
    this.directory = directory;
    this.release = release;
    this.execute = execute;
    this.ready = ready;
  }

  get running() {
    return this.active;
  }

  start(progress: (value: InstallProgress) => void, signal: AbortSignal) {
    this.starting ??= this.startNow(progress, signal).finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async startNow(
    progress: (value: InstallProgress) => void,
    signal: AbortSignal,
  ) {
    await this.pending;
    const image = this.release.serviceImage;
    if (!image)
      throw new Error("安装文件缺少 Docker 运行包。请重新安装 Domos。");
    await prepareWorkImages(this.release, progress, signal, this.execute);
    await this.execute("docker", ["compose", "version"], {
      signal,
      timeout: 30_000,
    });
    const stack = await this.prepare();
    signal.throwIfAborted();
    progress({ phase: "image", message: "首次准备可能需要几分钟…" });
    const build = this.release.serviceBuild;
    try {
      await this.execute("docker", ["image", "inspect", image], {
        signal,
        timeout: 30_000,
      });
    } catch {
      signal.throwIfAborted();
      await this.execute(
        "docker",
        build
          ? [
              "build",
              "--file",
              resolve(build.context, build.dockerfile),
              "--tag",
              image,
              build.context,
            ]
          : ["pull", image],
        { signal, timeout: operationTimeout },
      );
    }
    progress({ phase: "starting", message: "正在启动 Domos…" });
    try {
      await this.compose(
        ["up", "--detach", "--wait", "--wait-timeout", "120"],
        signal,
      );
      this.active = true;
      const origin = `http://127.0.0.1:${stack.port}`;
      await this.ready(
        origin,
        AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
      );
      this.origin = origin;
      progress({ phase: "ready", message: "Domos 已启动。" });
      return { origin, url: origin };
    } catch (error) {
      await this.compose(["stop", "--timeout", "10"]).catch(() => {});
      this.active = false;
      throw error;
    }
  }

  private async secret(name: string) {
    const filename = join(this.directory, name);
    try {
      return (await readFile(filename, "utf8")).trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const value = randomBytes(32).toString("hex");
      await writeFile(filename, value, { mode: 0o600, flag: "wx" });
      return value;
    }
  }

  private async prepare() {
    await mkdir(join(this.directory, "data"), { recursive: true, mode: 0o700 });
    const filename = join(this.directory, "stack.json");
    let stack: z.infer<typeof stackSchema>;
    try {
      stack = stackSchema.parse(JSON.parse(await readFile(filename, "utf8")));
      if (stack.directory !== this.directory) {
        stack = {
          id: `domos-${randomBytes(6).toString("hex")}`,
          port: await allocatePort(),
          directory: this.directory,
        };
        await writeConfiguration(filename, stack);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      stack = {
        id: `domos-${randomBytes(6).toString("hex")}`,
        port: await allocatePort(),
        directory: this.directory,
      };
      await writeConfiguration(filename, stack);
    }
    await this.secret("desktop-token");
    await this.secret("controller-token");
    const configFile = join(this.directory, "domos.config.json");
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(await readFile(configFile, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const template = workComputer(this.release);
      const work = {
        kind: "controller",
        id: template.id,
        endpoint: "http://controller:4311",
        credentialFile: "/control/controller-token",
        network: template.network,
        timeoutSeconds: template.timeoutSeconds,
      };
      config = {
        host: "127.0.0.1",
        port: stack.port,
        dataDir: join(this.directory, "data"),
        deployment: "container",
        computer: { kind: "process" },
        workComputer: work,
      };
      await writeConfiguration(join(this.directory, "controller.json"), {
        host: "0.0.0.0",
        port: 4311,
        credentialFile: "controller-token",
        computer: template,
      });
      await writeConfiguration(configFile, config);
    }
    await writeConfiguration(join(this.directory, "service.json"), {
      ...config,
      host: "0.0.0.0",
      port: 4310,
      publicUrl: `http://127.0.0.1:${stack.port}`,
      dataDir: "/data",
      staticDir: "/app/apps/web/dist",
      desktopCredentialFile: "/control/desktop-token",
    });
    await writeConfiguration(
      join(this.directory, "compose.json"),
      this.specification(stack),
    );
    return stack;
  }

  private specification(stack: z.infer<typeof stackSchema>) {
    const control = {
      type: "bind",
      source: this.directory,
      target: "/control",
      read_only: true,
    };
    const common = {
      image: this.release.serviceImage,
      init: true,
      read_only: true,
      cap_drop: ["ALL"],
      security_opt: ["no-new-privileges:true"],
      tmpfs: ["/tmp"],
      stop_grace_period: "30s",
    };
    return {
      name: stack.id,
      services: {
        app: {
          ...common,
          user: `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
          ports: [`127.0.0.1:${stack.port}:4310`],
          environment: {
            DOMOS_CONFIG: "/control/service.json",
            DOMOS_PUBLIC_URL: `http://127.0.0.1:${stack.port}`,
          },
          volumes: [
            control,
            {
              type: "bind",
              source: join(this.directory, "data"),
              target: "/data",
            },
          ],
          networks: ["default", "control"],
          depends_on: { controller: { condition: "service_healthy" } },
        },
        controller: {
          ...common,
          user: "0:0",
          cap_add: ["DAC_READ_SEARCH"],
          command: [
            "node",
            "apps/controller/src/main.ts",
            "/control/controller.json",
          ],
          volumes: [
            control,
            {
              type: "bind",
              source: "/var/run/docker.sock",
              target: "/var/run/docker.sock",
            },
          ],
          networks: ["control"],
          healthcheck: {
            test: [
              "CMD",
              "node",
              "apps/controller/src/health.ts",
              "/control/controller.json",
            ],
            interval: "2s",
            timeout: "5s",
            retries: 30,
          },
        },
      },
      networks: { control: { internal: true } },
    };
  }

  private compose(args: string[], signal?: AbortSignal) {
    return this.execute(
      "docker",
      ["compose", "--file", join(this.directory, "compose.json"), ...args],
      { signal, timeout: operationTimeout },
    );
  }

  async pair() {
    if (!this.origin || !this.active) throw new Error("请先启动 Domos。");
    const token = await this.secret("desktop-token");
    const response = await fetch(new URL("/hosting/desktop", this.origin), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("桌面连接未完成。请重试。");
    return sessionSchema.parse(await response.json());
  }

  stop() {
    const starting = this.starting;
    this.pending = this.pending
      .catch(() => {})
      .then(async () => {
        await starting?.catch(() => {});
        if (this.active) await this.compose(["stop", "--timeout", "30"]);
        this.active = false;
        this.origin = undefined;
      });
    return this.pending;
  }
}
