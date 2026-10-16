import { EventEmitter, on } from "node:events";
import { platform } from "node:os";
import type { Context } from "@earendil-works/chord/context";
import {
  type ConversationId,
  configure,
  type DocumentReader,
  type Harness,
  type ToolRegistration,
  type Tx,
} from "@earendil-works/pi-durable";
import type { Bots } from "../bots.ts";
import {
  type ComputerConfig,
  computerSchema,
  type RuntimeConfig,
} from "../runtime/config.ts";
import { requiredText, requireRevision, WorkError } from "../work/state.ts";
import { Computer, type ComputerStatus } from "./index.ts";
import {
  type ComputerRecord,
  ComputersDoc,
  requireComputer,
  requireIdle,
} from "./state.ts";

export type ComputerView = ComputerStatus & {
  name: string;
  authorized: boolean;
  capabilities: { commands: boolean; files: boolean; desktop: false };
};

export class Computers {
  private harness!: Harness;
  private readonly targets = new Map<string, Computer>();
  private readonly changing = new Set<string>();
  private readonly transfers = new Map<number, number>();
  private tools: readonly ToolRegistration[] = [];
  private shells: readonly ToolRegistration[] = [];
  private readonly events = new EventEmitter();

  readonly config: RuntimeConfig;
  constructor(config: RuntimeConfig) {
    this.config = config;
  }

  install(
    tools: readonly ToolRegistration[],
    shells: readonly ToolRegistration[],
  ) {
    this.tools = tools;
    this.shells = shells;
  }

  async initialize(
    harness: Harness,
    bots: Bots,
    context: Context,
    legacy = false,
  ) {
    this.harness = harness;
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
          : this.tools,
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
      name: item.name,
      authorized: item.authorized,
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
    if (this.changing.has(id))
      throw new WorkError("CONFLICT", "工作电脑正在操作中。");
    return this.target(item).workspace(botId, context);
  }

  async environment(botId: number, context: Context, read: DocumentReader) {
    const doc = await read.snapshot(ComputersDoc, context);
    if (!doc?.bindings[String(botId)]?.computerId) return undefined;
    return this.workspace(botId, context, read);
  }

  async preflight(botId: number, context: Context) {
    const binding = await this.binding(botId, context);
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

  async attachmentComputerId(context: Context) {
    return (
      (await this.harness.snapshot(ComputersDoc, context))
        ?.attachmentComputerId ?? null
    );
  }

  async transfer<T>(botId: number, action: () => Promise<T>, context: Context) {
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
