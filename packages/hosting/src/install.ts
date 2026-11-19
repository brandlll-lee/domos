import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { prepareDockerImage } from "@domos/agent/computer/docker";
import { computerSchema } from "@domos/agent/config";
import { z } from "zod";

export type InstallProgress = { phase: string; message: string };
export const releaseSchema = z
  .object({
    version: z.string(),
    serviceImage: z
      .string()
      .regex(/^\S+@sha256:[a-f0-9]{64}$/)
      .optional(),
    workImage: z
      .string()
      .regex(/^\S+@sha256:[a-f0-9]{64}$/)
      .optional(),
    proxyImage: z
      .string()
      .regex(/^\S+@sha256:[a-f0-9]{64}$/)
      .optional(),
    controllerEntry: z.string(),
    serverEntry: z.string(),
    bridgeEntry: z.string(),
    workerEntry: z.string().optional(),
    staticDir: z.string(),
  })
  .strict();
export type Release = z.infer<typeof releaseSchema>;
export const publishedReleaseSchema = releaseSchema.required({
  serviceImage: true,
  workImage: true,
  proxyImage: true,
});

export function workComputer(release: Release) {
  if (!release.workImage) return undefined;
  const id = `team-${randomBytes(6).toString("hex")}`;
  return computerSchema.options[1].parse({
    kind: "docker",
    id,
    image: release.workImage,
    volume: `domos-${id}-work`,
    network: release.proxyImage ? "web" : "none",
    ...(release.proxyImage ? { proxyImage: release.proxyImage } : {}),
  });
}

export async function runCommand(
  command: string,
  args: string[],
  options: {
    signal?: AbortSignal;
    cwd?: string;
    timeout?: number;
    output?: (value: string) => void;
  } = {},
) {
  return new Promise<string>((resolve, reject) => {
    const { output, ...settings } = options;
    const child = spawn(command, args, {
      ...settings,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      output?.(chunk.toString("utf8"));
      size += chunk.length;
      if (size <= 1024 * 1024) chunks.push(chunk);
    });
    const diagnostics: Buffer[] = [];
    let diagnosticSize = 0;
    child.stderr.on("data", (chunk: Buffer) => {
      output?.(chunk.toString("utf8"));
      diagnosticSize += chunk.length;
      if (diagnosticSize <= 1024 * 1024) diagnostics.push(chunk);
    });
    child.once("error", (cause) =>
      reject(new Error("无法执行安装命令。请检查运行环境和权限。", { cause })),
    );
    child.once("close", (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks).toString("utf8").trim())
        : reject(
            new Error("安装步骤未完成。请检查网络和运行环境后重试。", {
              cause: {
                command,
                exitCode: code,
                stderr: Buffer.concat(diagnostics).toString("utf8").trim(),
              },
            }),
          ),
    );
  });
}

export async function allocatePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("端口不可用。");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

export async function prepareLocalInstallation(
  directory: string,
  release: Release,
) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const configFile = join(directory, "domos.config.json");
  const controllerFile = join(directory, "controller.json");
  try {
    const config = JSON.parse(await readFile(configFile, "utf8"));
    if (
      release.workImage &&
      (!config.workComputer ||
        (config.workComputer.kind === "docker" && !config.workComputer.ssh))
    ) {
      config.workComputer = {
        ...(config.workComputer ?? workComputer(release)),
        image: release.workImage,
        proxyImage: release.proxyImage,
      };
      await writeConfiguration(configFile, config);
    }
    return { configFile, controllerFile, config };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const config = {
    host: "127.0.0.1",
    port: await allocatePort(),
    dataDir: join(directory, "data"),
    staticDir: release.staticDir,
    computer: { kind: "process" },
    workComputer: workComputer(release),
  };
  await writeConfiguration(configFile, config);
  return { configFile, controllerFile, config };
}

export async function writeConfiguration(filename: string, value: unknown) {
  const temporary = `${filename}.pending`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temporary, filename);
}

export class DockerError extends Error {
  readonly code: "missing" | "stopped" | "mode" | "connection";
  constructor(code: DockerError["code"], message: string, cause?: unknown) {
    super(message, { cause });
    this.code = code;
  }
}

export async function checkDocker(signal?: AbortSignal, execute = runCommand) {
  signal?.throwIfAborted();
  let system: string;
  try {
    system = await execute("docker", ["info", "--format", "{{json .OSType}}"], {
      signal,
      timeout: 30_000,
    });
  } catch (error) {
    signal?.throwIfAborted();
    const cause = error instanceof Error ? error.cause : error;
    if (z.object({ code: z.literal("ENOENT") }).safeParse(cause).success)
      throw new DockerError(
        "missing",
        "未安装 Docker。请先安装 Docker Desktop。",
        error,
      );
    const diagnostic = z.object({ stderr: z.string() }).safeParse(cause);
    if (
      diagnostic.success &&
      /is the docker daemon running|cannot connect to the docker daemon|(?:dockerDesktopLinuxEngine|docker_engine).*(?:cannot find|not find|找不到)|docker\.sock.*no such file/i.test(
        diagnostic.data.stderr,
      )
    )
      throw new DockerError(
        "stopped",
        "Docker 引擎未启动。请启动 Docker Desktop。",
        error,
      );
    throw new DockerError(
      "connection",
      `Docker 连接失败。${diagnostic.success ? diagnostic.data.stderr.slice(0, 600) : error instanceof Error ? error.message : "请检查权限与连接设置。"}`,
      error,
    );
  }
  if (JSON.parse(system) !== "linux")
    throw new DockerError(
      "mode",
      "Docker 当前使用 Windows 容器。请切换为 Linux 容器模式。",
    );
}

export async function startDocker(
  signal: AbortSignal,
  progress: (value: InstallProgress) => void,
  execute = runCommand,
) {
  signal.throwIfAborted();
  progress({
    phase: "checking",
    message: "正在启动 Docker Desktop，等待引擎就绪…",
  });
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
  try {
    await execute("docker", ["desktop", "start", "--timeout", "120"], {
      signal: deadline,
      timeout: 130_000,
    });
  } catch (error) {
    deadline.throwIfAborted();
    const detail = z
      .object({ stderr: z.string() })
      .safeParse(error instanceof Error ? error.cause : undefined);
    throw new Error(
      `Docker Desktop 启动失败。${detail.success ? detail.data.stderr.slice(0, 600) : "请检查 Docker Desktop 安装与权限。"}`,
      { cause: error },
    );
  }
  while (true) {
    try {
      await checkDocker(deadline, execute);
      return;
    } catch (error) {
      deadline.throwIfAborted();
      if (!(error instanceof DockerError) || error.code !== "stopped")
        throw error;
    }
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(deadline.reason);
      };
      const timer = setTimeout(() => {
        deadline.removeEventListener("abort", abort);
        resolve();
      }, 500);
      deadline.addEventListener("abort", abort, { once: true });
      if (deadline.aborted) abort();
    });
  }
}

export async function prepareImage(
  image: string,
  progress: (value: InstallProgress) => void,
  signal?: AbortSignal,
  execute = runCommand,
) {
  signal?.throwIfAborted();
  let reported = 0;
  await prepareDockerImage(image, (args) => {
    const pulling = args[1] === "pull";
    if (pulling)
      progress({ phase: "image", message: "正在下载当前版本的运行包…" });
    return execute("docker", [...args.slice(1)], {
      signal,
      timeout: pulling ? 20 * 60_000 : 30_000,
      output: pulling
        ? (value) => {
            if (Date.now() - reported < 150) return;
            reported = Date.now();
            const line = value
              .trim()
              .split(/[\r\n]+/)
              .at(-1)
              ?.slice(0, 160);
            if (line)
              progress({ phase: "image", message: `正在下载运行包… ${line}` });
          }
        : undefined,
    });
  });
}

export async function prepareInstallation(
  directory: string,
  release: Release,
  progress: (value: InstallProgress) => void,
  signal?: AbortSignal,
  execute: typeof runCommand = runCommand,
) {
  const stage = (phase: string, message: string) => {
    signal?.throwIfAborted();
    progress({ phase, message });
  };
  stage("checking", "正在检查 Docker…");
  await checkDocker(signal, execute);
  if (!release.workImage)
    throw new Error("发布清单缺少工作镜像。请使用正式发布清单。");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const configFile = join(directory, "domos.config.json");
  const controllerFile = join(directory, "controller.json");
  stage("configuration", "正在准备配置…");
  let existing: unknown;
  try {
    existing = JSON.parse(await readFile(configFile, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (existing) return { configFile, controllerFile, config: existing };
  const servicePort = await allocatePort();
  let controlPort = await allocatePort();
  while (controlPort === servicePort) controlPort = await allocatePort();
  const credentialFile = join(directory, "controller-token");
  try {
    await writeFile(credentialFile, randomBytes(32).toString("base64url"), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const id = randomBytes(6).toString("hex");
  await writeConfiguration(controllerFile, {
    host: "127.0.0.1",
    port: controlPort,
    credentialFile,
    computer: {
      kind: "docker",
      id,
      image: release.workImage,
      ...(release.proxyImage ? { proxyImage: release.proxyImage } : {}),
      volume: `domos-${id}-work`,
      network: release.proxyImage ? "web" : "none",
    },
  });
  const config = {
    host: "127.0.0.1",
    port: servicePort,
    dataDir: join(directory, "data"),
    staticDir: release.staticDir,
    computer: {
      kind: "controller",
      id,
      endpoint: `http://127.0.0.1:${controlPort}`,
      credentialFile,
      network: release.proxyImage ? "web" : "none",
    },
  };
  await writeConfiguration(configFile, config);
  return { configFile, controllerFile, config };
}

export async function waitForService(origin: string, signal: AbortSignal) {
  while (!signal.aborted) {
    try {
      const response = await fetch(new URL("/hosting/info", origin), {
        signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]),
        redirect: "error",
      });
      const info = await response.json();
      if (response.ok && info.product === "domos") return;
    } catch {
      signal.throwIfAborted();
    }
    await new Promise<void>((resolve) => {
      const abort = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, 100);
      signal.addEventListener("abort", abort, { once: true });
    });
  }
  signal.throwIfAborted();
}
