import { spawn } from "node:child_process";
import type { Duplex } from "node:stream";
import type { ComputerDriver } from "@domos/agent/computer/driver";

export class ControlTarget {
  readonly driver: ComputerDriver;
  private readonly processes = new Set<ReturnType<typeof spawn>>();
  private pending: Promise<unknown> = Promise.resolve();
  private used = false;
  private generation = 0;

  constructor(driver: ComputerDriver) {
    this.driver = driver;
  }

  async status() {
    await this.pending.catch(() => {});
    return this.inspect();
  }

  private async inspect() {
    const state = await this.driver.inspect();
    if (state === "running") await this.driver.checkNetwork();
    return { state, network: this.driver.config.network };
  }

  change(action: "start" | "stop" | "rebuild") {
    this.generation++;
    this.used = true;
    const result = this.pending
      .catch(() => {})
      .then(async () => {
        for (const child of this.processes) child.kill();
        await this.driver[action]();
        return this.inspect();
      });
    this.pending = result;
    return result;
  }

  async connect(socket: Duplex, head: Buffer, token?: string, botId?: number) {
    await this.pending;
    const generation = this.generation;
    if ((await this.driver.inspect()) !== "running") throw new Error("Stopped");
    await this.driver.checkNetwork();
    const command = botId
      ? await this.driver.process?.(botId)
      : await this.driver.daemon();
    if (!command) throw new Error("Process channel required");
    const [program, ...args] = command;
    if (!program) throw new Error("Daemon required");
    if (!botId && !token) throw new Error("Daemon token required");
    if (generation !== this.generation) throw new Error("Computer changed");
    this.used = true;
    const child = spawn(
      program,
      botId ? args : [...args, "serve", "--token", token ?? ""],
      {
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
      },
    );
    this.processes.add(child);
    child.once("spawn", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) child.stdin.write(head);
      socket.pipe(child.stdin);
      child.stdout.pipe(socket);
    });
    child.once("error", () => {
      this.processes.delete(child);
      socket.destroy();
    });
    child.once("exit", () => {
      this.processes.delete(child);
      socket.end();
    });
    socket.once("close", () => {
      child.stdin.end();
      child.kill();
    });
  }

  async close() {
    for (const child of this.processes) child.kill();
    await this.pending.catch(() => {});
    if (this.used) await this.driver.stop();
  }
}
