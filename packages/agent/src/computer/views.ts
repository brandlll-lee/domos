import { randomUUID } from "node:crypto";
import type { Context } from "@earendil-works/chord/context";
import type { Computers } from "./catalog.ts";
import type { Computer } from "./index.ts";
import type { ComputerService } from "./service-types.ts";
import type { ViewerAction, ViewFrame } from "./viewer-types.ts";

type View = {
  botId: number;
  service: ComputerService;
  computerId: string;
  target: Computer;
  controller: AbortController;
  lease?: string;
};

export class ComputerViews {
  private readonly sessions = new Map<string, View>();
  private readonly computers: Computers;
  constructor(computers: Computers) {
    this.computers = computers;
  }

  async open(
    botId: number,
    service: ComputerService,
    signal: AbortSignal,
    context: Context,
  ) {
    const {
      target,
      enabled,
      id: computerId,
    } = await this.computers.serviceTarget(botId, context);
    if (!enabled[service]) throw new Error("请先启用这项电脑服务。");
    target.services.viewAccess(botId, service);
    const state = await target.services.prepare(botId, service, context);
    if (!state.available) throw new Error(state.error ?? "电脑服务不可用。");
    const id = randomUUID();
    await target.services.viewer(
      botId,
      { operation: "view", service, id, action: "open" },
      signal,
      context,
    );
    this.sessions.set(id, {
      botId,
      service,
      computerId,
      target,
      controller: new AbortController(),
    });
    if (signal.aborted) {
      await this.close(id, context);
      signal.throwIfAborted();
    }
    return id;
  }

  private async session(botId: number, id: string, context: Context) {
    const view = this.sessions.get(id);
    if (!view || view.botId !== botId)
      throw new Error("画面连接已失效。请重新连接。");
    const {
      target,
      enabled,
      id: computerId,
    } = await this.computers.serviceTarget(botId, context);
    if (
      target !== view.target ||
      computerId !== view.computerId ||
      !enabled[view.service]
    )
      throw new Error("工作电脑配置已改变。请重新连接。");
    return view;
  }

  async next(
    botId: number,
    id: string,
    signal: AbortSignal,
    context: Context,
  ): Promise<ViewFrame> {
    const view = await this.session(botId, id, context);
    view.target.services.viewAccess(botId, view.service, view.lease);
    const frame = await view.target.services.viewer<ViewFrame>(
      botId,
      { operation: "view", service: view.service, id, action: "next" },
      AbortSignal.any([signal, view.controller.signal]),
      context,
    );
    view.target.services.viewAccess(botId, view.service, view.lease);
    return frame;
  }

  async action(
    botId: number,
    id: string,
    message: ViewerAction,
    signal: AbortSignal,
    context: Context,
  ) {
    const view = await this.session(botId, id, context);
    if (message.type === "take") {
      if (!view.lease) {
        const lease = await view.target.services.takeover(botId, view.service);
        if (!this.sessions.has(id)) {
          await view.target.services.release(botId, view.service, lease);
          throw new Error("画面连接已断开。");
        }
        view.lease = lease;
      }
    } else if (message.type === "back") {
      if (view.lease)
        await view.target.services.release(botId, view.service, view.lease);
      view.lease = undefined;
    } else {
      view.target.services.viewAccess(botId, view.service, view.lease);
      if (message.type !== "ack" && !view.lease)
        throw new Error("请先接管，再操作电脑。");
      await view.target.services.viewer(
        botId,
        {
          operation: "view",
          service: view.service,
          id,
          action: "send",
          message,
        },
        signal,
        context,
      );
    }
    return { controlling: Boolean(view.lease) };
  }

  async close(id: string, context: Context) {
    const view = this.sessions.get(id);
    if (!view) return;
    this.sessions.delete(id);
    view.controller.abort();
    try {
      await view.target.services.viewer(
        view.botId,
        { operation: "view", service: view.service, id, action: "close" },
        AbortSignal.timeout(3000),
        context,
      );
    } finally {
      if (view.lease)
        await view.target.services
          .release(view.botId, view.service, view.lease)
          .catch(() => {});
    }
  }

  async closeBot(botId: number, service: ComputerService, context: Context) {
    await Promise.all(
      [...this.sessions]
        .filter(([, view]) => view.botId === botId && view.service === service)
        .map(([id]) => this.close(id, context)),
    );
  }
}
