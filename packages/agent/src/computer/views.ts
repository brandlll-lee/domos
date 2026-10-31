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
  taking?: Promise<void>;
  requestId?: string;
};

export class ComputerViews {
  private readonly sessions = new Map<string, View>();
  private readonly computers: Computers;
  private readonly requestControl: (
    botId: number,
    id: string,
    controlling: boolean,
    context: Context,
  ) => Promise<void>;
  constructor(
    computers: Computers,
    requestControl: ComputerViews["requestControl"] = async () => {},
  ) {
    this.computers = computers;
    this.requestControl = requestControl;
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
    const controller = new AbortController();
    this.sessions.set(id, {
      botId,
      service,
      computerId,
      target,
      controller,
    });
    signal.addEventListener(
      "abort",
      () => {
        void this.close(id, context).catch(() => {});
      },
      { once: true, signal: controller.signal },
    );
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
      if (!view.lease && !view.taking) {
        view.lease = randomUUID();
        view.taking = view.target.services
          .takeover(botId, view.service, view.lease)
          .then(() => {})
          .catch((error: unknown) => {
            view.lease = undefined;
            throw error;
          })
          .finally(() => {
            view.taking = undefined;
          });
      }
      await view.taking;
      if (!this.sessions.has(id)) throw new Error("画面连接已断开。");
    } else if (message.type === "back") {
      await view.taking;
      if (view.lease) {
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
        await view.target.services.release(botId, view.service, view.lease);
      }
      view.lease = undefined;
      if (view.requestId)
        await this.requestControl(botId, view.requestId, false, context);
    } else {
      view.target.services.viewAccess(botId, view.service, view.lease);
      if (message.type !== "ack" && view.taking)
        throw new Error("正在交接控制权。请等待。");
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
        AbortSignal.timeout(35000),
        context,
      );
    } finally {
      await view.taking?.catch(() => {});
      if (view.lease)
        await view.target.services.release(
          view.botId,
          view.service,
          view.lease,
        );
      if (view.requestId)
        await this.requestControl(view.botId, view.requestId, false, context);
    }
  }

  async closeBot(botId: number, service: ComputerService, context: Context) {
    await Promise.all(
      [...this.sessions]
        .filter(([, view]) => view.botId === botId && view.service === service)
        .map(([id]) => this.close(id, context)),
    );
  }

  async capture(botId: number, service: ComputerService, context: Context) {
    const signal = AbortSignal.timeout(5000);
    const id = await this.open(botId, service, signal, context);
    try {
      const frame = await this.next(botId, id, signal, context);
      return {
        type: "image" as const,
        data: frame.data,
        mimeType: frame.mimeType,
      };
    } finally {
      await this.close(id, context);
    }
  }

  async takeRequest(
    botId: number,
    id: string,
    requestId: string,
    service: ComputerService,
    computerId: string,
    context: Context,
  ) {
    const view = await this.session(botId, id, context);
    if (view.service !== service || view.computerId !== computerId)
      throw new Error("接管目标已改变。请打开请求对应的画面。");
    const state = await this.action(
      botId,
      id,
      { type: "take" },
      AbortSignal.timeout(35000),
      context,
    );
    view.requestId = requestId;
    await this.requestControl(botId, requestId, true, context);
    return state;
  }

  async finishRequest(botId: number, requestId: string, context: Context) {
    const match = [...this.sessions].find(
      ([, view]) =>
        view.botId === botId && view.requestId === requestId && view.lease,
    );
    if (!match) throw new Error("请先从这张卡片接管，完成后再继续任务。");
    await this.action(
      botId,
      match[0],
      { type: "back" },
      AbortSignal.timeout(35000),
      context,
    );
    match[1].requestId = undefined;
  }
}
