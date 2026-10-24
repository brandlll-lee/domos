import { EventEmitter, on } from "node:events";
import { platform } from "node:os";
import { characterIdentity } from "@domos/ui/characters";
import type { Context } from "@earendil-works/chord/context";
import type { CredentialStore } from "@earendil-works/pi-ai";
import {
  type ConversationId,
  configure,
  type DocumentReader,
  type Harness,
  type ToolRegistration,
  type Tx,
} from "@earendil-works/pi-durable";
import type { Bots } from "../bots.ts";
import type {
  EngineProcess,
  ProductResult,
  ProductTool,
} from "../harness/types.ts";
import {
  type ComputerConfig,
  computerSchema,
  type RuntimeConfig,
} from "../runtime/config.ts";
import { requiredText, requireRevision, WorkError } from "../work/state.ts";
import { ComputerAssistance } from "./assistance.ts";
import { Computer, type ComputerStatus } from "./index.ts";
import { ComputerPreparation } from "./preparation.ts";
import type { ComputerService } from "./service-types.ts";
import {
  type ComputerRecord,
  ComputersDoc,
  requireComputer,
  requireIdle,
} from "./state.ts";
import { ComputerTools } from "./tools.ts";
import { ComputerViews } from "./views.ts";

export type ComputerView = ComputerStatus & {
  name: string;
  authorized: boolean;
  capabilities: { commands: boolean; files: boolean; desktop: false };
  scope?: ComputerRecord["scope"];
  busy: boolean;
};

export class Computers {
  readonly tools = new ComputerTools(this);
  readonly views = new ComputerViews(this);
  private harness!: Harness;
  private bots!: Bots;
  private readonly targets = new Map<string, Computer>();
  private readonly changing = new Set<string>();
  private readonly transfers = new Map<number, number>();
  private readonly starting = new Map<string, Promise<void>>();
  private registrations: readonly ToolRegistration[] = [];
  private shells: readonly ToolRegistration[] = [];
  private readonly events = new EventEmitter();

  readonly config: RuntimeConfig;
  preparation!: ComputerPreparation;
  assistance!: ComputerAssistance;
  constructor(config: RuntimeConfig) {
    this.config = config;
  }

  install(
    tools: readonly ToolRegistration[],
    shells: readonly ToolRegistration[],
  ) {
    this.registrations = tools;
    this.shells = shells;
  }

  async initialize(
    harness: Harness,
    bots: Bots,
    context: Context,
    legacy = false,
    credentials?: CredentialStore,
  ) {
    this.harness = harness;
    this.bots = bots;
    this.preparation = new ComputerPreparation(harness, this);
    this.assistance = new ComputerAssistance(harness, credentials);
    if (await harness.snapshot(ComputersDoc, context)) return;
    if (legacy) await new Computer(this.config).bind();
    const contacts = await bots.list(context);
    const configured = this.config.computer;
    const id = configured.kind === "process" ? "process" : configured.id;
    await harness.commit(async (tx) => {
      const doc = await tx.doc(ComputersDoc);
      doc.attachmentComputerId = legacy ? id : null;
      doc.items.push({
        id: "process",
        name: "本机",
        config: { kind: "process" },
        authorized: legacy && id === "process",
      });
      if (id !== "process")
        doc.items.push({
          id,
          name: "工作电脑",
          config: configured,
          authorized: true,
        });
      for (const bot of contacts)
        await this.attach(tx, bot.id, legacy ? id : null);
    }, context);
  }

  async attach(tx: Tx, botId: number, computerId?: string | null) {
    const doc = await tx.doc(ComputersDoc);
    const id = computerId === undefined ? doc.defaultId : computerId;
    const item = id === null ? undefined : requireComputer(doc.items, id);
    if (id && this.changing.has(id))
      throw new WorkError("CONFLICT", "工作电脑正在操作中。");
    if (item && !item.authorized)
      throw new WorkError("BAD_REQUEST", "请先授权这台电脑。");
    if (item?.scope?.kind === "dedicated" && item.scope.botId !== botId)
      throw new WorkError("BAD_REQUEST", "这台独立电脑属于另一个 Bot。");
    doc.bindings[String(botId)] = {
      computerId: id,
      revision: 0,
      requestId: "",
    };
    await this.configure(tx, botId, item);
  }

  private configure(tx: Tx, botId: number, item?: ComputerRecord) {
    const shell =
      item?.config.kind === "process" && platform() === "win32"
        ? this.shells[1]
        : this.shells[0];
    return configure(tx, botId as ConversationId, {
      tools: {
        remove: item?.authorized
          ? this.shells.filter((tool) => tool !== shell)
          : this.registrations,
      },
    });
  }

  private target(item: ComputerRecord) {
    let target = this.targets.get(item.id);
    if (!target) {
      target = new Computer({ ...this.config, computer: item.config });
      this.targets.set(item.id, target);
    }
    return target;
  }

  async list(context: Context) {
    const doc = await this.harness.snapshot(ComputersDoc, context);
    return {
      items: await Promise.all(
        (doc?.items ?? []).map((item) => this.view(item)),
      ),
      defaultId: doc?.defaultId ?? null,
      bindings: doc?.bindings ?? {},
    };
  }

  async *watch(signal: AbortSignal, context: Context) {
    const changes = on(this.events, "change", { signal });
    const unsubscribe = this.harness.subscribeCommits(({ changes }) => {
      if (
        changes.some(
          (change) =>
            change.type === "document" &&
            change.record.kind === ComputersDoc.definition.kind,
        )
      )
        this.events.emit("change");
    });
    try {
      yield await this.list(context);
      for await (const _ of changes) yield await this.list(context);
    } catch (error) {
      if (!signal.aborted) throw error;
    } finally {
      unsubscribe();
      await changes.return?.();
    }
  }

  private async view(item: ComputerRecord): Promise<ComputerView> {
    const status = await this.target(item).status();
    const available =
      item.authorized &&
      status.state === "running" &&
      !this.changing.has(item.id);
    return {
      ...status,
      id: item.id,
      name:
        item.config.kind === "process"
          ? this.config.deployment === "container"
            ? "服务所在容器"
            : "服务所在电脑"
          : item.name,
      authorized: item.authorized,
      scope: item.scope,
      busy: this.changing.has(item.id),
      capabilities: { commands: available, files: available, desktop: false },
    };
  }

  async binding(
    botId: number,
    context: Context,
    read: DocumentReader = this.harness,
  ) {
    const doc = await read.snapshot(ComputersDoc, context);
    const binding = doc?.bindings[String(botId)] ?? {
      computerId: null,
      revision: 0,
      requestId: "",
    };
    const item =
      binding.computerId === null
        ? undefined
        : requireComputer(doc?.items ?? [], binding.computerId);
    return { ...binding, computer: item ? await this.view(item) : null };
  }

  async workspace(
    botId: number,
    context: Context,
    read: DocumentReader = this.harness,
  ) {
    const doc = await read.snapshot(ComputersDoc, context);
    const id = doc?.bindings[String(botId)]?.computerId;
    if (!id) throw new WorkError("BAD_REQUEST", "请先为 Bot 分配工作电脑。");
    const item = requireComputer(doc?.items ?? [], id);
    if (!item.authorized)
      throw new WorkError("BAD_REQUEST", "这台电脑的授权已撤销。");
    if (item.scope) await this.ensureReady(id, context);
    if (this.changing.has(id))
      throw new WorkError("CONFLICT", "工作电脑正在操作中。");
    return this.target(item).workspace(botId, context);
  }

  async environment(botId: number, context: Context, read: DocumentReader) {
    const doc = await read.snapshot(ComputersDoc, context);
    if (!doc?.bindings[String(botId)]?.computerId) return undefined;
    return this.workspace(botId, context, read);
  }

  async process(
    botId: number,
    tools: ProductTool[],
    invoke: (
      callId: string,
      name: string,
      args: Record<string, unknown>,
      signal: AbortSignal,
    ) => Promise<ProductResult>,
    context: Context,
  ): Promise<EngineProcess> {
    const ready = Promise.withResolvers<EngineProcess>();
    void this.transfer(
      botId,
      async () => {
        const doc = await this.harness.snapshot(ComputersDoc, context);
        const id = doc?.bindings[String(botId)]?.computerId;
        if (!id) throw new WorkError("BAD_REQUEST", "请先选择工作电脑。");
        const worker = await this.target(
          requireComputer(doc?.items ?? [], id),
        ).process(botId, tools, invoke, context);
        ready.resolve(worker);
        await worker.closed;
      },
      context,
    ).catch(ready.reject);
    return ready.promise;
  }

  async preflight(botId: number, context: Context) {
    let binding = await this.binding(botId, context);
    if (binding.computer?.authorized && binding.computer.scope) {
      await this.ensureReady(binding.computer.id, context);
      binding = await this.binding(botId, context);
    }
    if (binding.computer && !binding.computer.capabilities.commands)
      throw new WorkError(
        "BAD_REQUEST",
        "工作电脑不可用。请检查目标状态和授权。",
      );
  }

  async computerId(botId: number, context: Context) {
    return (
      (await this.harness.snapshot(ComputersDoc, context))?.bindings[
        String(botId)
      ]?.computerId ?? null
    );
  }

  async serviceTarget(botId: number, context: Context) {
    await this.workspace(botId, context);
    const doc = await this.harness.snapshot(ComputersDoc, context);
    const binding = doc?.bindings[String(botId)];
    if (!binding?.computerId)
      throw new WorkError("BAD_REQUEST", "请先选择工作电脑。");
    return {
      id: binding.computerId,
      target: this.target(
        requireComputer(doc?.items ?? [], binding.computerId),
      ),
      enabled: binding.services ?? {},
    };
  }

  async color(botId: number, context: Context) {
    return characterIdentity((await this.bots.profile(botId, context)).avatar)
      .color;
  }

  async serviceSettings(
    botId: number,
    service: ComputerService,
    enabled: boolean,
    context: Context,
  ) {
    await this.harness.commit(async (tx) => {
      const binding = (await tx.doc(ComputersDoc)).bindings[String(botId)];
      if (!binding?.computerId)
        throw new WorkError("BAD_REQUEST", "请先选择工作电脑。");
      binding.services = { ...binding.services, [service]: enabled };
    }, context);
  }

  async attachmentComputerId(context: Context) {
    return (
      (await this.harness.snapshot(ComputersDoc, context))
        ?.attachmentComputerId ?? null
    );
  }

  async transfer<T>(botId: number, action: () => Promise<T>, context: Context) {
    await this.preflight(botId, context);
    await this.harness.commit(async (tx) => {
      await tx.doc(ComputersDoc);
      this.transfers.set(botId, (this.transfers.get(botId) ?? 0) + 1);
    }, context);
    try {
      return await action();
    } finally {
      const remaining = (this.transfers.get(botId) ?? 1) - 1;
      if (remaining) this.transfers.set(botId, remaining);
      else this.transfers.delete(botId);
    }
  }

  private async idle(tx: Tx, botId: number) {
    if (this.transfers.has(botId))
      throw new WorkError("CONFLICT", "请等待文件传输或消息提交完成。");
    await requireIdle(tx, botId);
  }

  async assertIdle(botId: number, context: Context) {
    await this.harness.commit((tx) => this.idle(tx, botId), context);
  }

  ensureReady(id: string, context: Context) {
    const existing = this.starting.get(id);
    if (existing) return existing;
    const pending = (async () => {
      const doc = await this.harness.snapshot(ComputersDoc, context);
      const item = requireComputer(doc?.items ?? [], id);
      if (!item.authorized)
        throw new WorkError("BAD_REQUEST", "这台电脑的授权已撤销。");
      if ((await this.target(item).status()).state !== "running")
        await this.manage(id, "start", context);
    })().finally(() => this.starting.delete(id));
    this.starting.set(id, pending);
    return pending;
  }

  async assign(
    botId: number,
    input: { computerId: string | null; revision: number; requestId: string },
    context: Context,
  ) {
    await this.harness.commit(async (tx) => {
      const doc = await tx.doc(ComputersDoc);
      const previous = doc.bindings[String(botId)];
      if (previous?.requestId === input.requestId) return;
      requireRevision(previous?.revision ?? 0, input.revision);
      await this.idle(tx, botId);
      await this.attach(tx, botId, input.computerId);
      doc.bindings[String(botId)] = { ...input, revision: input.revision + 1 };
    }, context);
    return this.binding(botId, context);
  }

  async approval(
    botId: number,
    input: { computerId: string; revision: number; mode: "ask" | "auto" },
    context: Context,
  ) {
    await this.harness.commit(async (tx) => {
      const doc = await tx.doc(ComputersDoc);
      const binding = doc.bindings[String(botId)];
      requireRevision(binding?.revision ?? 0, input.revision);
      if (!binding || binding.computerId !== input.computerId)
        throw new WorkError("CONFLICT", "工作电脑已改变。请刷新后重试。");
      if (!requireComputer(doc.items, input.computerId).authorized)
        throw new WorkError("BAD_REQUEST", "请先授权这台电脑。");
      binding.approvalMode = input.mode;
    }, context);
    return this.list(context);
  }

  async add(input: { name: string; config: ComputerConfig }, context: Context) {
    const config = computerSchema.parse(input.config);
    if (config.kind === "process")
      throw new WorkError("BAD_REQUEST", "本机已在电脑目录中。");
    const item = {
      id: config.id,
      name: requiredText(input.name, 80),
      config,
      authorized: true,
    };
    await this.harness.commit(async (tx) => {
      const doc = await tx.doc(ComputersDoc);
      const previous = doc.items.find((target) => target.id === item.id);
      if (previous) {
        if (JSON.stringify(previous) === JSON.stringify(item)) return;
        throw new WorkError("CONFLICT", "电脑标识已存在。");
      }
      doc.items.push(item);
    }, context);
    return this.list(context);
  }

  async authorize(id: string, authorized: boolean, context: Context) {
    if (this.changing.has(id))
      throw new WorkError("CONFLICT", "工作电脑正在操作中。");
    await this.harness.commit(async (tx) => {
      const doc = await tx.doc(ComputersDoc);
      const item = requireComputer(doc.items, id);
      const bindings = Object.entries(doc.bindings).filter(
        ([, binding]) => binding.computerId === id,
      );
      for (const [botId] of bindings) await this.idle(tx, Number(botId));
      item.authorized = authorized;
      if (!authorized)
        for (const [, binding] of bindings) {
          delete binding.approvalMode;
          delete binding.assistance;
          binding.revision++;
        }
      if (!authorized && doc.defaultId === id) doc.defaultId = null;
      for (const [botId] of bindings)
        await this.configure(tx, Number(botId), item);
    }, context);
    await this.targets.get(id)?.close(context);
    return this.list(context);
  }

  async setDefault(id: string | null, context: Context) {
    await this.harness.commit(async (tx) => {
      const doc = await tx.doc(ComputersDoc);
      if (id && !requireComputer(doc.items, id).authorized)
        throw new WorkError("BAD_REQUEST", "请先授权这台电脑。");
      if (id && requireComputer(doc.items, id).scope?.kind === "dedicated")
        throw new WorkError("BAD_REQUEST", "独立电脑不能设为共享电脑。");
      doc.defaultId = id;
    }, context);
    return this.list(context);
  }

  async manage(
    id: string,
    action: "start" | "stop" | "rebuild",
    context: Context,
  ) {
    const doc = await this.harness.snapshot(ComputersDoc, context);
    const item = requireComputer(doc?.items ?? [], id);
    if (!item.authorized)
      throw new WorkError("BAD_REQUEST", "请先授权这台电脑。");
    if (this.changing.has(id))
      throw new WorkError("CONFLICT", "工作电脑正在操作中。");
    this.changing.add(id);
    this.events.emit("change");
    try {
      await this.target(item).manage(action, context, () =>
        this.harness.commit(async (tx) => {
          for (const [botId, binding] of Object.entries(
            (await tx.doc(ComputersDoc)).bindings,
          ))
            if (binding.computerId === id) await this.idle(tx, Number(botId));
        }, context),
      );
      return await this.view(item);
    } finally {
      this.changing.delete(id);
      this.events.emit("change");
    }
  }

  async close(context: Context) {
    await Promise.all(
      [...this.targets.values()].map((target) => target.close(context)),
    );
  }
}
