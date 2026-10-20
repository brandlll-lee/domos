import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { computerSchema } from "@domos/agent/config";
import { z } from "zod";

export type InstallProgress = { phase: string; message: string };
export const releaseSchema = z
  .object({
    version: z.string(),
    serviceImage: z.string().min(1).optional(),
    serviceBuild: z
      .object({ context: z.string(), dockerfile: z.string() })
      .optional(),
    workImage: z.string().min(1),
    proxyImage: z.string().min(1).optional(),
    proxyBuild: z
      .object({ context: z.string(), dockerfile: z.string() })
      .optional(),
    controllerEntry: z.string(),
    serverEntry: z.string(),
    bridgeEntry: z.string(),
    workerEntry: z.string().optional(),
    staticDir: z.string(),
    workBuild: z
      .object({ context: z.string(), dockerfile: z.string() })
      .optional(),
  })
  .strict();
export type Release = z.infer<typeof releaseSchema>;

export function workComputer(release: Release) {
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
  } = {},
) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= 1024 * 1024) chunks.push(chunk);
    });
    const diagnostics: Buffer[] = [];
    let diagnosticSize = 0;
    child.stderr.on("data", (chunk: Buffer) => {
      diagnosticSize += chunk.length;
      if (diagnosticSize <= 1024 * 1024) diagnostics.push(chunk);
    });
    child.once("error", () =>
      reject(new Error("无法执行安装命令。请检查运行环境和权限。")),
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
    return {
      configFile,
      controllerFile,
      config: JSON.parse(await readFile(configFile, "utf8")),
    };
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

export async function prepareWorkImages(
  release: Release,
  progress: (value: InstallProgress) => void,
  signal?: AbortSignal,
  execute: typeof runCommand = runCommand,
) {
  const stage = (phase: string, message: string) => {
    signal?.throwIfAborted();
    progress({ phase, message });
  };
  stage("checking", "正在检查 Docker 和目录权限…");
  const system = await execute(
    "docker",
    ["info", "--format", "{{json .OSType}}"],
    {
      signal,
      timeout: 30_000,
    },
  ).catch(() => {
    signal?.throwIfAborted();
    throw new Error("无法连接 Docker。请安装并启动 Docker Desktop，然后重试。");
  });
  if (JSON.parse(system) !== "linux")
    throw new Error("请将 Docker 切换为 Linux 容器模式。");
  stage("image", "正在准备 Linux 工作镜像…");
  for (const { image, build } of [
    { image: release.workImage, build: release.workBuild },
    ...(release.proxyImage
      ? [{ image: release.proxyImage, build: release.proxyBuild }]
      : []),
  ]) {
    try {
      await execute("docker", ["image", "inspect", image], {
        signal,
        timeout: 30_000,
      });
    } catch {
      signal?.throwIfAborted();
      if (build)
        await execute(
          "docker",
          [
            "build",
            "-f",
            resolve(build.context, build.dockerfile),
            "-t",
            image,
            build.context,
          ],
          { signal, timeout: 20 * 60_000 },
        );
      else
        await execute("docker", ["pull", image], {
          signal,
          timeout: 20 * 60_000,
        });
    }
  }
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
  await prepareWorkImages(release, progress, signal, execute);
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
      }, 500);
      signal.addEventListener("abort", abort, { once: true });
    });
  }
  signal.throwIfAborted();
}
