import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { DesktopIdentity } from "./desktop.ts";
import {
  allocatePort,
  checkDocker,
  type InstallProgress,
  prepareImage,
  type Release,
  runCommand,
  waitForService,
  workComputer,
  writeConfiguration,
} from "./install.ts";

import { StackUpgrade } from "./stack-upgrade.ts";

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
    progress({ phase: "checking", message: "正在检查 Docker…" });
    await checkDocker(signal, this.execute);
    if (!image)
      throw new Error("安装文件缺少 Docker 运行包。请重新安装 Domos。");
    await this.execute("docker", ["compose", "version"], {
      signal,
      timeout: 30_000,
    });
    await prepareImage(image, progress, signal, this.execute);
    const upgrade = new StackUpgrade(this.directory);
    const saved = await upgrade.state();
    if (saved && saved.phase !== "complete") {
      await this.compose(["stop", "--timeout", "30"]);
      await this.recover(upgrade);
      throw new Error(
        `上次升级未完成，已恢复原后台。失败数据保留在 ${upgrade.directory}。请重试更新。`,
      );
    }
    const previous = await this.savedSpecification();
    let replacing = false;
    if (previous && previous.services.app.image !== image) {
      progress({ phase: "backup", message: "正在保护数据，准备更新后台…" });
      const port = previous.services.app.ports[0];
      if (!port) throw new Error("原后台端口配置缺失。");
      const origin = `http://127.0.0.1:${port.split(":")[1]}`;
      const ids = await this.compose(["ps", "--quiet", "app"], signal);
      const held = Boolean(ids.trim());
      if (held) await this.maintenance(origin, true, signal);
      try {
        await this.compose(["stop", "--timeout", "30"], signal);
        await upgrade.save(held);
      } catch (error) {
        await this.compose([
          "up",
          "--detach",
          "--wait",
          "--wait-timeout",
          "120",
        ]);
        await this.ready(origin, AbortSignal.timeout(120_000));
        if (held) await this.maintenance(origin, false);
        throw error;
      }
      replacing = true;
    }
    try {
      const stack = await this.prepare(replacing);
      signal.throwIfAborted();
      if (replacing) await upgrade.phase("starting");
      progress({ phase: "starting", message: "正在启动 Domos…" });
      await this.compose(
        ["up", "--detach", "--wait", "--wait-timeout", "120"],
        signal,
      );
      const origin = `http://127.0.0.1:${stack.port}`;
      await this.ready(
        origin,
        AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
      );
      const expected = await this.execute(
        "docker",
        ["image", "inspect", "--format", "{{.Id}}", image],
        { signal, timeout: 30_000 },
      );
      for (const service of ["app", "controller"]) {
        const id = await this.compose(["ps", "--quiet", service], signal);
        if (!id.trim()) throw new Error("后台容器未启动。");
        const actual = await this.execute(
          "docker",
          ["inspect", "--format", "{{.Image}}", id.trim()],
          { signal, timeout: 30_000 },
        );
        if (!expected.trim() || actual.trim() !== expected.trim())
          throw new Error("后台容器版本与发布清单不一致。");
      }
      if (replacing) {
        await writeConfiguration(
          join(this.directory, "compose.json"),
          this.specification(stack, false),
        );
        await upgrade.phase("complete");
      }
      replacing = false;
      await this.maintenance(origin, false, signal);
      this.active = true;
      this.origin = origin;
      progress({ phase: "ready", message: "Domos 已启动。" });
      return { origin, url: origin };
    } catch (error) {
      this.active = false;
      await this.compose(["stop", "--timeout", "30"]);
      if (replacing) await this.recover(upgrade);
      throw error;
    }
  }

  private async recover(upgrade: StackUpgrade) {
    const state = await upgrade.state();
    await upgrade.restore();
    const previous = await this.savedSpecification();
    const port = previous?.services.app.ports[0];
    if (!port) throw new Error("备份缺少后台端口，恢复已停止。");
    const origin = `http://127.0.0.1:${port.split(":")[1]}`;
    await this.compose(["up", "--detach", "--wait", "--wait-timeout", "120"]);
    await this.ready(origin, AbortSignal.timeout(120_000));
    if (state?.held) await this.maintenance(origin, false);
    await upgrade.phase("complete");
  }

  private async savedSpecification() {
    try {
      return z
        .object({
          services: z.object({
            app: z.object({
              image: z.string(),
              ports: z.array(z.string()).min(1),
            }),
          }),
        })
        .parse(
          JSON.parse(
            await readFile(join(this.directory, "compose.json"), "utf8"),
          ),
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async maintenance(
    origin: string,
    held: boolean,
    signal = AbortSignal.timeout(15_000),
  ) {
    const token = await this.secret("desktop-token");
    const response = await fetch(new URL("/hosting/desktop", origin), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ maintenance: held }),
      redirect: "error",
      signal,
    });
    if (!response.ok) {
      const message = z
        .object({ error: z.string() })
        .safeParse(await response.json());
      throw new Error(
        message.success
          ? message.data.error
          : "后台未能切换维护状态。请等待任务完成，并确认后台支持安全升级。",
      );
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

  private async prepare(maintenance: boolean) {
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
      if (!template)
        throw new Error("发布清单缺少 Bot 工作环境。请重新安装正式发布包。");
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
      desktopUrl: `http://127.0.0.1:${stack.port}`,
      dataDir: "/data",
      staticDir: "/app/apps/web/dist",
      desktopCredentialFile: "/control/desktop-token",
    });
    await writeConfiguration(
      join(this.directory, "compose.json"),
      this.specification(stack, maintenance),
    );
    return stack;
  }

  private specification(
    stack: z.infer<typeof stackSchema>,
    maintenance: boolean,
  ) {
    const control = {
      type: "bind",
      source: this.directory,
      target: "/control",
      read_only: true,
    };
    const images = {
      DOMOS_WORK_IMAGE: this.release.workImage,
      DOMOS_PROXY_IMAGE: this.release.proxyImage,
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
            ...images,
            DOMOS_CONFIG: "/control/service.json",
            ...(maintenance ? { DOMOS_MAINTENANCE: "1" } : {}),
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
          environment: images,
          cap_add: ["DAC_READ_SEARCH"],
          command: [
            "node",
            "apps/controller/src/main.ts",
            "/control/controller.json",
          ],
          volumes: [
            { ...control, read_only: false },
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

  async pair(identity: DesktopIdentity) {
    if (!this.origin || !this.active) throw new Error("请先启动 Domos。");
    const token = await this.secret("desktop-token");
    const response = await fetch(new URL("/hosting/desktop", this.origin), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(identity),
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
