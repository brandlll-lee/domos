import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { ComputerConfig } from "../runtime/config.ts";
import type { ComputerDriver } from "./driver.ts";

export class ControllerComputer implements ComputerDriver {
  readonly config: Extract<ComputerConfig, { kind: "controller" }>;
  readonly directory = "/home/domos";
  constructor(config: Extract<ComputerConfig, { kind: "controller" }>) {
    const url = new URL(config.endpoint);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !["http:", "https:"].includes(url.protocol)
    )
      throw new Error("控制端地址无效。");
    this.config = config;
  }
  get binding() {
    return {
      kind: this.config.kind,
      id: this.config.id,
      endpoint: this.config.endpoint,
    };
  }
  private async request(action: string, method = "GET") {
    const token = (await readFile(this.config.credentialFile, "utf8")).trim();
    const response = await fetch(
      new URL(`/${this.config.id}/${action}`, this.config.endpoint),
      {
        method,
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(60_000),
        redirect: "error",
      },
    );
    if (!response.ok)
      throw new Error("工作电脑控制端未完成请求。请核对实际状态。");
    return response.json() as Promise<{
      state: "running" | "stopped" | "missing";
      network: string;
    }>;
  }
  async inspect() {
    return (await this.request("status")).state;
  }
  async checkNetwork() {
    if ((await this.request("status")).network !== this.config.network)
      throw new Error("工作电脑网络策略与配置不匹配。");
  }
  async start() {
    await this.request("start", "POST");
  }
  async stop() {
    await this.request("stop", "POST");
  }
  async rebuild() {
    await this.request("rebuild", "POST");
  }
  daemon() {
    const entry =
      process.env.DOMOS_BRIDGE_ENTRY ??
      fileURLToPath(new URL("./bridge.ts", import.meta.url));
    return [
      process.execPath,
      entry,
      this.config.endpoint,
      this.config.id,
      this.config.credentialFile,
    ];
  }

  process(botId: number) {
    return [...this.daemon(), "process", String(botId)];
  }
}
