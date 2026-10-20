import type { DockerConfig } from "../runtime/config.ts";

const gateway = "com.docker.network.bridge.gateway_mode_ipv4";
export const proxyUrl = "http://egress:3128";
type Command = (args: readonly string[]) => Promise<string>;

export class WebNetwork {
  readonly config: DockerConfig;
  readonly command: Command;
  readonly network: string;
  readonly proxy: string;
  constructor(config: DockerConfig, command: Command, network: string) {
    if (!config.proxyImage) throw new Error("HTTP(S) 出网需要代理镜像。");
    this.config = config;
    this.command = command;
    this.network = network;
    this.proxy = `${network}-egress`;
  }

  async check() {
    const network = JSON.parse(
      await this.command([
        "docker",
        "network",
        "inspect",
        "--format",
        "{{json .}}",
        this.network,
      ]),
    );
    if (
      !network.Internal ||
      network.EnableIPv6 ||
      network.Options?.[gateway] !== "isolated"
    )
      throw new Error("工作网络缺少隔离网桥。");
    const proxy = JSON.parse(
      await this.command([
        "docker",
        "container",
        "inspect",
        "--format",
        "{{json .}}",
        this.proxy,
      ]),
    );
    const networks = Object.keys(proxy.NetworkSettings.Networks);
    if (
      !proxy.State.Running ||
      proxy.State.Health?.Status !== "healthy" ||
      proxy.Config.Image !== this.config.proxyImage ||
      proxy.Config.User !== "1000:1000" ||
      !proxy.HostConfig.Init ||
      !proxy.HostConfig.ReadonlyRootfs ||
      proxy.HostConfig.Privileged ||
      !proxy.HostConfig.CapDrop?.includes("ALL") ||
      proxy.HostConfig.CapAdd?.length ||
      !proxy.HostConfig.SecurityOpt?.includes("no-new-privileges:true") ||
      networks.length !== 2 ||
      !networks.includes(this.network) ||
      !networks.includes("bridge") ||
      proxy.Mounts.some(
        (mount: { Type: string; Destination: string }) =>
          mount.Type !== "tmpfs" || mount.Destination !== "/tmp",
      )
    )
      throw new Error("出网代理与隔离配置不一致。");
    await this.command(["docker", "exec", this.proxy, "squid", "-k", "check"]);
  }

  async start() {
    const exists = await this.command([
      "docker",
      "network",
      "ls",
      "-q",
      "--filter",
      `name=^${this.network}$`,
    ]);
    if (!exists)
      await this.command([
        "docker",
        "network",
        "create",
        "--internal",
        "--opt",
        `${gateway}=isolated`,
        this.network,
      ]);
    const proxy = await this.command([
      "docker",
      "container",
      "ls",
      "-aq",
      "--filter",
      `name=^/${this.proxy}$`,
    ]);
    if (!proxy) {
      await this.command([
        "docker",
        "container",
        "create",
        "--init",
        "--pull=never",
        "--name",
        this.proxy,
        "--network",
        this.network,
        "--network-alias",
        "egress",
        "--user",
        "1000:1000",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges:true",
        "--memory",
        "128m",
        "--cpus",
        "0.5",
        "--pids-limit",
        "64",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,size=32m,mode=1777",
        this.config.proxyImage as string,
      ]);
      await this.command([
        "docker",
        "network",
        "connect",
        "bridge",
        this.proxy,
      ]);
    }
    await this.command(["docker", "container", "start", this.proxy]);
    const deadline = AbortSignal.timeout(20_000);
    while (!deadline.aborted) {
      const state = JSON.parse(
        await this.command([
          "docker",
          "inspect",
          "--format",
          "{{json .State}}",
          this.proxy,
        ]),
      );
      if (!state.Running || state.Health?.Status === "unhealthy")
        throw new Error("出网代理启动失败。");
      if (state.Health?.Status === "healthy") break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    deadline.throwIfAborted();
    await this.check();
  }

  async stop() {
    const exists = await this.command([
      "docker",
      "container",
      "ls",
      "-aq",
      "--filter",
      `name=^/${this.proxy}$`,
    ]);
    if (exists)
      await this.command([
        "docker",
        "container",
        "stop",
        "--time",
        "10",
        this.proxy,
      ]);
  }

  async rebuild() {
    const exists = await this.command([
      "docker",
      "container",
      "ls",
      "-aq",
      "--filter",
      `name=^/${this.proxy}$`,
    ]);
    if (exists)
      await this.command(["docker", "container", "rm", "--force", this.proxy]);
  }
}
