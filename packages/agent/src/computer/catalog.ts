import { randomUUID } from "node:crypto";
import { EventEmitter, on } from "node:events";
import { readdir } from "node:fs/promises";
import { hostname, platform } from "node:os";
import { dirname, isAbsolute, join, posix } from "node:path";
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
import { BotDirectory, type Bots } from "../bots.ts";
import { owningBot } from "../conversations.ts";
import { EngineDoc } from "../harness/state.ts";
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
import { DockerComputer, prepareDockerImage } from "./docker.ts";
import { Computer, type ComputerStatus } from "./index.ts";
import { ComputerPreparation } from "./preparation.ts";
import { ComputerRequests } from "./runtime.ts";
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
  local: boolean;
};

export class Computers {
  owner(botId: number, context: Context) {
    return owningBot(this.harness, botId as ConversationId, context);
  }
  onIdle?: (botId: number) => Promise<void>;
  readonly tools = new ComputerTools(this);
  readonly views = new ComputerViews(
    this,
    async (botId, id, controlling, context) => {
      await this.harness.commit(async (tx) => {
        const request = (
          await tx.doc(ComputerRequests, botId as ConversationId)
        ).approvals.find((item) => item.id === id);
        if (request?.takeover)
          request.takeover.state = controlling ? "controlling" : "waiting";
      }, context);
    },
  );
  private harness!: Harness;
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
    this.preparation = new ComputerPreparation(harness, this);
    this.assistance = new ComputerAssistance(harness, credentials);
    if (await harness.snapshot(ComputersDoc, context)) {
      await harness.commit(async (tx) => {
        const doc = await tx.doc(ComputersDoc);
        doc.node ??= { id: randomUUID(), name: hostname() };
      }, context);
      return;
    }
    if (legacy) await new Computer(this.config).bind();
    const contacts = await bots.list(context);
    const configured = this.config.computer;
    const id = configured.kind === "process" ? "process" : configured.id;
    await harness.commit(async (tx) => {
      const doc = await tx.doc(ComputersDoc);
      doc.node = { id: randomUUID(), name: hostname() };
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
        await this.attach(tx, bot.id, legacy ? id : undefined, legacy);
    }, context);
  }

  local(config: ComputerConfig) {
    if (config.kind === "process") return true;
    if (config.kind === "docker") return !config.ssh;
    const work = this.config.workComputer;
    return (
      this.config.deployment === "container" &&
      work?.kind === "controller" &&
      config.endpoint === work.endpoint &&
      config.credentialFile === work.credentialFile
    );
  }

  async attach(
    tx: Tx,
    botId: number,
    computerId?: string | null,
    migrating = false,
  ) {
    const doc = await tx.doc(ComputersDoc);
    const id = computerId === undefined ? "process" : computerId;
    const item = id === null ? undefined : requireComputer(doc.items, id);
    if (!migrating && item && !this.local(item.config))
      throw new WorkError(
        "BAD_REQUEST",
        "请连接目标电脑上的 Domos，再创建 Bot。",
      );
    if (id && this.changing.has(id))
      throw new WorkError("CONFLICT", "工作电脑正在操作中。");
    if (computerId !== undefined && item && !item.authorized)
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

  async node(context: Context, name?: string) {
    if (name !== undefined)
      await this.harness.commit(async (tx) => {
        const doc = await tx.doc(ComputersDoc);
        if (doc.node) doc.node.name = requiredText(name, 80);
      }, context);
    const doc = await this.harness.snapshot(ComputersDoc, context);
    if (!doc?.node) throw new WorkError("NOT_FOUND", "电脑信息尚未初始化。");
    return { ...doc.node, state: "running" as const };
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
            ? "应用容器"
            : "此电脑"
          : item.name,
      local: this.local(item.config),
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
    botId = await owningBot(read, botId as ConversationId, context);
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
    return {
      ...binding,
      directory: binding.directory ?? null,
      computer: item ? await this.view(item) : null,
    };
  }

  async workspace(
    botId: number,
    context: Context,
    read: DocumentReader = this.harness,
    directory?: string | null,
  ) {
    botId = await owningBot(read, botId as ConversationId, context);
    const doc = await read.snapshot(ComputersDoc, context);
    const id = doc?.bindings[String(botId)]?.computerId;
    if (!id) throw new WorkError("BAD_REQUEST", "请先为 Bot 分配工作电脑。");
    const item = requireComputer(doc?.items ?? [], id);
    if (!item.authorized)
      throw new WorkError("BAD_REQUEST", "这台电脑的授权已撤销。");
    if (item.scope) await this.ensureReady(id, context);
    if (this.changing.has(id))
      throw new WorkError("CONFLICT", "工作电脑正在操作中。");
    return this.target(item).workspace(
      botId,
      context,
      directory === null
        ? undefined
        : (directory ?? doc?.bindings[String(botId)]?.directory),
    );
  }

  async environment(botId: number, context: Context, read: DocumentReader) {
    botId = await owningBot(read, botId as ConversationId, context);
    const doc = await read.snapshot(ComputersDoc, context);
    const id = doc?.bindings[String(botId)]?.computerId;
    if (!id || !requireComputer(doc?.items ?? [], id).authorized)
      return undefined;
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
    botId = await owningBot(this.harness, botId as ConversationId, context);
    const ready = Promise.withResolvers<EngineProcess>();
    void this.transfer(
      botId,
      async () => {
        const doc = await this.harness.snapshot(ComputersDoc, context);
        const id = doc?.bindings[String(botId)]?.computerId;
        if (!id) throw new WorkError("BAD_REQUEST", "请先选择工作电脑。");
        const worker = await this.target(
          requireComputer(doc?.items ?? [], id),
        ).process(
          botId,
          tools,
          invoke,
          context,
          doc?.bindings[String(botId)]?.directory,
        );
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

  async mcp<T = unknown>(
    computerId: string,
    input: Record<string, unknown>,
    context: Context,
    signal?: AbortSignal,
    botId?: number,
  ) {
    const worker = await this.mcpProcess(computerId, context, botId);
    try {
      return await worker.mcp<T>(input, signal);
    } finally {
      await worker.close();
    }
  }

  async mcpProcess(computerId: string, context: Context, bot?: number) {
    if (bot !== undefined) bot = await this.owner(bot, context);
    const doc = await this.harness.snapshot(ComputersDoc, context);
    const item = requireComputer(doc?.items ?? [], computerId);
    if (!item.authorized)
      throw new WorkError("BAD_REQUEST", "这台电脑的授权已撤销。");
    if (item.scope) await this.ensureReady(computerId, context);
    const botId =
      item.scope?.kind === "dedicated"
        ? item.scope.botId
        : (bot ??
          Number(
            Object.entries(doc?.bindings ?? {}).find(
              ([, binding]) => binding.computerId === computerId,
            )?.[0],
          ));
    if (item.scope?.kind === "dedicated" && bot && item.scope.botId !== bot)
      throw new WorkError("BAD_REQUEST", "此电脑属于其他 Bot。");
    if (!botId)
      throw new WorkError("BAD_REQUEST", "请先为此电脑分配 Bot，再测试 MCP。");
    return this.target(item).process(
      botId,
      [],
      async () => ({ content: [], isError: true }),
      context,
      doc?.bindings[String(botId)]?.directory,
    );
  }

  async computerId(botId: number, context: Context) {
    botId = await owningBot(this.harness, botId as ConversationId, context);
    return (
      (await this.harness.snapshot(ComputersDoc, context))?.bindings[
        String(botId)
      ]?.computerId ?? null
    );
  }

  async serviceTarget(botId: number, context: Context) {
    botId = await this.owner(botId, context);
    await this.workspace(botId, context);
    const doc = await this.harness.snapshot(ComputersDoc, context);
    const binding = doc?.bindings[String(botId)];
    if (!binding?.computerId)
      throw new WorkError("BAD_REQUEST", "请先选择工作电脑。");
    const bot = (
      await this.harness.snapshot(BotDirectory, context)
    )?.items.find((item) => item.id === botId);
    return {
      id: binding.computerId,
      target: this.target(
        requireComputer(doc?.items ?? [], binding.computerId),
      ),
      enabled: binding.services ?? {},
      cursorColor: bot ? characterIdentity(bot.avatar).color : undefined,
    };
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
    await this.onIdle?.(botId);
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
      if (input.computerId && input.computerId !== previous?.computerId) {
        const target = requireComputer(doc.items, input.computerId).config;
        if (!this.local(target))
          throw new WorkError(
            "BAD_REQUEST",
            "请连接目标电脑上的 Domos，再创建 Bot。",
          );
      }
      await this.idle(tx, botId);
      await this.attach(
        tx,
        botId,
        input.computerId,
        input.computerId === previous?.computerId,
      );
      doc.bindings[String(botId)] = { ...input, revision: input.revision + 1 };
      const engine = await tx.doc(EngineDoc, botId as ConversationId);
      if (engine.config.approvalMode) {
        engine.config.approvalMode = "ask";
        engine.revision++;
      }
    }, context);
    return this.binding(botId, context);
  }

  async directory(
    input: {
      botId: number;
      directory: string | null;
      revision: number;
      requestId: string;
    },
    context: Context,
  ) {
    const binding = await this.binding(input.botId, context);
    if (binding.requestId === input.requestId) return binding;
    requireRevision(binding.revision, input.revision);
    if (!binding.computer?.authorized)
      throw new WorkError("BAD_REQUEST", "请先授权文件与命令访问。");
    const doc = await this.harness.snapshot(ComputersDoc, context);
    const target = this.target(
      requireComputer(doc?.items ?? [], binding.computer.id),
    );
    const directory =
      input.directory === null
        ? undefined
        : requiredText(input.directory, 4096);
    await target.workspace(input.botId, context, directory);
    await this.harness.commit(async (tx) => {
      const current = (await tx.doc(ComputersDoc)).bindings[
        String(input.botId)
      ];
      if (!current) throw new WorkError("NOT_FOUND", "Bot 环境不存在。");
      requireRevision(current.revision, input.revision);
      await this.idle(tx, input.botId);
      current.directory = directory;
      current.requestId = input.requestId;
      current.revision++;
      const engine = await tx.doc(EngineDoc, input.botId as ConversationId);
      engine.prepared = false;
      engine.runtime = undefined;
      engine.prompt = null;
      engine.revision++;
    }, context);
    return this.binding(input.botId, context);
  }

  async directories(botId: number, path: string | undefined, context: Context) {
    const workspace = await this.workspace(botId, context);
    const binding = await this.binding(botId, context);
    const current = path ?? workspace.cwd;
    if (binding.computer?.kind === "process") {
      if (!isAbsolute(current))
        throw new WorkError("BAD_REQUEST", "请输入绝对目录。");
      const entries = await readdir(current, { withFileTypes: true });
      return {
        path: current,
        parent: dirname(current),
        items: entries
          .filter((item) => item.isDirectory())
          .map((item) => ({ name: item.name, path: join(current, item.name) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    }
    const entries = await workspace.listDir(
      await workspace.path(current),
      context,
    );
    if (!entries.ok) throw entries.error;
    return {
      path: current,
      parent: posix.dirname(current),
      items: entries.value
        .filter((item) => item.kind === "directory")
        .map(({ name, path }) => ({ name, path }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
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
      await this.idle(tx, botId);
      const engine = await tx.doc(EngineDoc, botId as ConversationId);
      if (engine.config.approvalMode) {
        delete engine.config.approvalMode;
        engine.revision++;
      }
      binding.approvalMode = input.mode;
    }, context);
    return this.list(context);
  }

  async add(input: { name: string; config: ComputerConfig }, context: Context) {
    const config = computerSchema.parse(input.config);
    if (
      config.kind === "controller" ||
      (config.kind === "docker" && config.ssh)
    )
      throw new WorkError(
        "BAD_REQUEST",
        "请连接目标电脑上的 Domos，再创建 Bot。",
      );
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
        for (const [botId, binding] of bindings) {
          delete binding.approvalMode;
          delete binding.assistance;
          binding.revision++;
          const engine = await tx.doc(
            EngineDoc,
            Number(botId) as ConversationId,
          );
          if (engine.config.approvalMode) {
            engine.config.approvalMode = "ask";
            engine.revision++;
          }
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
    let item = requireComputer(doc?.items ?? [], id);
    if (!item.authorized)
      throw new WorkError("BAD_REQUEST", "请先授权这台电脑。");
    if (this.changing.has(id))
      throw new WorkError("CONFLICT", "工作电脑正在操作中。");
    this.changing.add(id);
    this.events.emit("change");
    try {
      const idle = () =>
        this.harness.commit(async (tx) => {
          for (const [botId, binding] of Object.entries(
            (await tx.doc(ComputersDoc)).bindings,
          ))
            if (binding.computerId === id) await this.idle(tx, Number(botId));
        }, context);
      const template = this.config.workComputer;
      if (
        action === "rebuild" &&
        item.config.kind === "docker" &&
        !item.config.ssh &&
        template?.kind === "docker" &&
        !template.ssh
      ) {
        const config = { ...item.config, image: template.image };
        if (template.proxyImage) config.proxyImage = template.proxyImage;
        else delete config.proxyImage;
        const driver = new DockerComputer(config);
        for (const image of [config.image, config.proxyImage])
          if (image)
            await prepareDockerImage(image, driver.command.bind(driver));
        await idle();
        await this.target(item).close(context);
        await this.harness.commit(async (tx) => {
          const doc = await tx.doc(ComputersDoc);
          for (const [botId, binding] of Object.entries(doc.bindings))
            if (binding.computerId === id) await this.idle(tx, Number(botId));
          requireComputer(doc.items, id).config = config;
        }, context);
        this.targets.delete(id);
        item = { ...item, config };
      }

      await this.target(item).manage(action, context, idle);
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
