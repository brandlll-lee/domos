import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { sshArguments } from "@earendil-works/pi-env";
import type { DockerConfig } from "../runtime/config.ts";

const execute = promisify(execFile);
export const sandboxHome = "/home/domos";
export const sandboxDaemon = "/usr/local/bin/pi-env";
export const sandboxUser = "1000:1000";
export const firewallCommand = "/usr/local/sbin/domos-computer-egress";
const label = "domos.computer";
const specLabel = "domos.spec";

export function quoteArgument(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function hostCommand(config: DockerConfig, args: readonly string[]) {
  return config.ssh
    ? ["ssh", ...sshArguments(config.ssh), args.map(quoteArgument).join(" ")]
    : [...args];
}

export function sandboxSpec(config: DockerConfig) {
  const { ssh: _ssh, ...spec } = config;
  return createHash("sha256").update(JSON.stringify(spec)).digest("hex");
}

export function sandboxNames(config: DockerConfig) {
  return {
    container: `domos-${config.id}`,
    network: `domos-${config.id}`,
    bridge: `domos-c${createHash("sha256").update(config.id).digest("hex").slice(0, 7)}`,
  };
}

export function createArguments(config: DockerConfig) {
  const names = sandboxNames(config);
  return [
    "docker",
    "container",
    "create",
    "--pull=never",
    "--name",
    names.container,
    "--label",
    `${label}=${config.id}`,
    "--label",
    `${specLabel}=${sandboxSpec(config)}`,
    "--user",
    sandboxUser,
    "--workdir",
    sandboxHome,
    "--init",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true",
    "--cpus",
    String(config.cpus),
    "--memory",
    `${config.memoryMiB}m`,
    "--memory-swap",
    `${config.memoryMiB}m`,
    "--pids-limit",
    String(config.pids),
    "--network",
    config.network === "none" ? "none" : names.network,
    "--mount",
    `type=volume,source=${config.volume},target=${sandboxHome}`,
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=128m,mode=1777",
    config.image,
  ];
}

type Inspection = {
  running: boolean;
  spec: string;
  user: string;
  privileged: boolean;
  readonly: boolean;
  caps: string[];
  added: string[] | null;
  cpus: number;
  memory: number;
  pids: number;
  pidMode: string;
  networks: Record<string, unknown>;
  security: string[];
  network: string;
  mounts: { Type: string; Name: string; Destination: string }[];
};
const inspection =
  '{"running":{{json .State.Running}},"spec":{{json (index .Config.Labels "domos.spec")}},"user":{{json .Config.User}},"privileged":{{json .HostConfig.Privileged}},"readonly":{{json .HostConfig.ReadonlyRootfs}},"caps":{{json .HostConfig.CapDrop}},"added":{{json .HostConfig.CapAdd}},"cpus":{{json .HostConfig.NanoCpus}},"memory":{{json .HostConfig.Memory}},"pids":{{json .HostConfig.PidsLimit}},"pidMode":{{json .HostConfig.PidMode}},"networks":{{json .NetworkSettings.Networks}},"security":{{json .HostConfig.SecurityOpt}},"network":{{json .HostConfig.NetworkMode}},"mounts":{{json .Mounts}}}';

export class DockerComputer {
  readonly config: DockerConfig;

  constructor(config: DockerConfig) {
    this.config = config;
  }

  async command(args: readonly string[]) {
    const [program, ...argv] = hostCommand(this.config, args);
    if (!program) throw new Error("电脑控制命令缺失。");
    try {
      const result = await execute(program, argv, {
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
      return result.stdout.trim();
    } catch {
      throw new Error(
        "电脑控制请求未完成。请检查 Docker、SSH 主机密钥和权限；核对实际状态后再重试。",
      );
    }
  }

  async inspect() {
    const names = sandboxNames(this.config);
    const id = await this.command([
      "docker",
      "container",
      "ls",
      "-aq",
      "--filter",
      `name=^/${names.container}$`,
    ]);
    if (!id) return "missing" as const;
    const info: Inspection = JSON.parse(
      await this.command([
        "docker",
        "container",
        "inspect",
        "--format",
        inspection,
        names.container,
      ]),
    );
    const mounts = info.mounts.filter((mount) => mount.Destination !== "/tmp");
    if (
      info.spec !== sandboxSpec(this.config) ||
      info.user !== sandboxUser ||
      info.privileged ||
      !info.readonly ||
      !info.caps?.includes("ALL") ||
      info.added?.length ||
      info.security?.length !== 1 ||
      !info.security.includes("no-new-privileges:true") ||
      info.cpus !== Math.round(this.config.cpus * 1_000_000_000) ||
      info.memory !== this.config.memoryMiB * 1024 * 1024 ||
      info.pids !== this.config.pids ||
      info.pidMode ||
      (info.running && Object.keys(info.networks).length !== 1) ||
      info.network !==
        (this.config.network === "none" ? "none" : names.network) ||
      mounts.length !== 1 ||
      mounts[0]?.Type !== "volume" ||
      mounts[0]?.Name !== this.config.volume ||
      mounts[0]?.Destination !== sandboxHome
    )
      throw new Error("工作容器与配置或隔离要求不一致。请停止后重建工作容器。");
    return info.running ? ("running" as const) : ("stopped" as const);
  }

  async checkNetwork() {
    if (this.config.network !== "restricted") return;
    await this.command(["sudo", "-n", firewallCommand, "--check"]);
  }

  async provision() {
    await this.checkNetwork();
    if (this.config.network === "restricted") {
      const names = sandboxNames(this.config);
      const exists = await this.command([
        "docker",
        "network",
        "ls",
        "-q",
        "--filter",
        `name=^${names.network}$`,
      ]);
      if (!exists)
        await this.command([
          "docker",
          "network",
          "create",
          "--driver",
          "bridge",
          "--label",
          `${label}=${this.config.id}`,
          "--opt",
          `com.docker.network.bridge.name=${names.bridge}`,
          names.network,
        ]);
      const actual = await this.command([
        "docker",
        "network",
        "inspect",
        "--format",
        '{{index .Options "com.docker.network.bridge.name"}}',
        names.network,
      ]);
      if (actual !== names.bridge)
        throw new Error("沙箱网络缺少受限防火墙接口。");
    }
    await this.command(createArguments(this.config));
  }

  async start() {
    const state = await this.inspect();
    if (state === "missing") await this.provision();
    await this.checkNetwork();
    if (state !== "running")
      await this.command([
        "docker",
        "container",
        "start",
        sandboxNames(this.config).container,
      ]);
  }

  async stop() {
    if ((await this.inspect()) === "running")
      await this.command([
        "docker",
        "container",
        "stop",
        "--time",
        "10",
        sandboxNames(this.config).container,
      ]);
  }

  async rebuild() {
    const name = sandboxNames(this.config).container;
    const id = await this.command([
      "docker",
      "container",
      "ls",
      "-aq",
      "--filter",
      `label=${label}=${this.config.id}`,
      "--filter",
      `name=^/${name}$`,
    ]);
    if (id) await this.command(["docker", "container", "rm", "--force", name]);
    await this.provision();
    await this.start();
  }

  daemon() {
    return hostCommand(this.config, [
      "docker",
      "container",
      "exec",
      "-i",
      "--user",
      sandboxUser,
      "--workdir",
      sandboxHome,
      sandboxNames(this.config).container,
      sandboxDaemon,
    ]);
  }
}
