import { randomUUID } from "node:crypto";
import { on } from "node:events";
import type { Context } from "@earendil-works/chord/context";
import type { WorkProcess } from "../harness/process.ts";
import type { ProductResult } from "../harness/types.ts";
import type { ComputerActivity } from "./activity.ts";
import type {
  ComputerRequest,
  ComputerService,
  ServiceState,
} from "./service-types.ts";

type Control = {
  owner?: string;
  lease?: string;
  revision: number;
  calls: Set<{
    botId: number;
    controller: AbortController;
    done: Promise<unknown>;
  }>;
  botId?: number;
};

export class ComputerServices {
  private readonly workers = new Map<number, Promise<WorkProcess>>();
  private readonly controls = new Map<string, Control>();
  private readonly open: (
    botId: number,
    context: Context,
  ) => Promise<WorkProcess>;

  constructor(open: (botId: number, context: Context) => Promise<WorkProcess>) {
    this.open = open;
  }

  private worker(botId: number, context: Context) {
    let worker = this.workers.get(botId);
    if (!worker) {
      worker = this.open(botId, context);
      this.workers.set(botId, worker);
      void worker
        .then((process) => process.closed)
        .catch(() => {})
        .finally(() => {
          if (this.workers.get(botId) === worker) this.workers.delete(botId);
        });
    }
    return worker;
  }

  private control(botId: number, service: ComputerService) {
    const key = service === "desktop" ? service : `${service}:${botId}`;
    let control = this.controls.get(key);
    if (!control) {
      control = { revision: 0, calls: new Set() };
      this.controls.set(key, control);
    }
    return control;
  }

  async prepare(
    botId: number,
    service: ComputerService,
    context: Context,
    install = false,
  ): Promise<ServiceState> {
    try {
      const worker = await this.worker(botId, context);
      if (install && service === "browser")
        await worker.computer({ operation: "install", service });
      return await worker.computer<ServiceState>({
        operation: "prepare",
        service,
      });
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : "工作电脑服务不可用。",
      };
    }
  }

  async catalog(botId: number, service: ComputerService, context: Context) {
    return (await this.worker(botId, context)).computer({
      operation: "catalog",
      service,
    });
  }

  async viewer<T>(
    botId: number,
    input: Extract<ComputerRequest, { operation: "view" }>,
    signal: AbortSignal,
    context: Context,
  ) {
    return (await this.worker(botId, context)).computer<T>(input, signal);
  }

  viewAccess(botId: number, service: ComputerService, lease?: string) {
    const control = this.control(botId, service);
    if (control.lease && control.lease !== lease)
      throw new Error("用户正在另一窗口接管。请等待交还控制权。");
    if (lease && control.lease !== lease) throw new Error("这次接管已失效。");
  }

  async call(
    botId: number,
    service: ComputerService,
    name: string,
    args: Record<string, unknown>,
    owner: string,
    signal: AbortSignal,
    context: Context,
    actor?: { botId: number; color: string; owner: string },
  ) {
    return this.run(botId, service, owner, signal, async (combined) => {
      const worker = await this.worker(botId, context);
      combined.throwIfAborted();
      return worker.computer<ProductResult>(
        { operation: "call", service, name, arguments: args, actor },
        combined,
      );
    });
  }

  async run<T>(
    botId: number,
    service: ComputerService,
    owner: string,
    signal: AbortSignal,
    action: (signal: AbortSignal) => Promise<T>,
  ) {
    signal.throwIfAborted();
    const control = this.control(botId, service);
    if (control.lease) throw new Error("用户正在接管。交还后请重新观察画面。");
    if (control.owner && control.owner !== owner)
      throw new Error("其他任务正在操作这台电脑。请等待该任务结束。");
    control.owner = owner;
    control.botId = botId;
    const revision = control.revision;
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    const done = action(combined);
    const pending = { botId, controller, done };
    control.calls.add(pending);
    try {
      const result = await done;
      if (combined.aborted || revision !== control.revision)
        throw new Error("操作结果待核对。请重新观察画面，不要直接重试。");
      return result;
    } catch (error) {
      if (combined.aborted || revision !== control.revision)
        throw new Error("操作结果待核对。请重新观察画面，不要直接重试。");
      throw error;
    } finally {
      control.calls.delete(pending);
    }
  }

  async takeover(botId: number, service: ComputerService) {
    const control = this.control(botId, service);
    if (control.lease) throw new Error("用户正在接管这台电脑。");
    const lease = randomUUID();
    control.lease = lease;
    control.revision++;
    for (const call of control.calls) call.controller.abort();
    await Promise.allSettled([...control.calls].map((call) => call.done));
    if (service === "desktop") await this.clearActivity(control);
    return lease;
  }

  async release(botId: number, service: ComputerService, lease: string) {
    const control = this.control(botId, service);
    if (control.lease !== lease) throw new Error("这次接管已失效。");
    control.lease = undefined;
    control.revision++;
  }

  async disable(botId: number, service: ComputerService) {
    const control = this.control(botId, service);
    const calls = [...control.calls].filter((call) => call.botId === botId);
    for (const call of calls) call.controller.abort();
    await Promise.allSettled(calls.map((call) => call.done));
    if (service === "desktop" && control.botId === botId)
      await this.clearActivity(control);
  }

  finish(owner: string) {
    for (const control of this.controls.values()) {
      if (control.owner !== owner) continue;
      for (const call of control.calls) call.controller.abort();
      void this.clearActivity(control);
      control.owner = undefined;
    }
  }

  private async clearActivity(control: Control) {
    const owner = control.owner;
    const worker = control.botId && this.workers.get(control.botId);
    if (worker)
      await worker
        .then((process) => process.computer({ operation: "activity", owner }))
        .catch(() => {});
  }

  async *activity(
    botId: number,
    signal: AbortSignal,
    context: Context,
  ): AsyncGenerator<ComputerActivity> {
    const worker = await this.worker(botId, context);
    const connection = new AbortController();
    const close = () => connection.abort();
    worker.events.once("closed", close);
    const events = on(worker.events, "activity", {
      signal: AbortSignal.any([signal, connection.signal]),
    });
    try {
      yield worker.activity;
      for await (const [state] of events) {
        yield state as ComputerActivity;
      }
    } catch (error) {
      if (!connection.signal.aborted) throw error;
    } finally {
      worker.events.off("closed", close);
      await events.return?.();
    }
  }

  async close() {
    for (const control of this.controls.values())
      for (const call of control.calls) call.controller.abort();
    await Promise.allSettled(
      [...this.workers.values()].map(async (worker) => (await worker).close()),
    );
    this.workers.clear();
    this.controls.clear();
  }
}
