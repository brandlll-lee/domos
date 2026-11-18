import { randomUUID } from "node:crypto";
import type { Context } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { Attachment } from "../attachments.ts";
import type { Computers } from "../computer/catalog.ts";
import { computerInstructions } from "../computer/instructions.ts";
import { ComputerRequests, type ComputerRuntime } from "../computer/runtime.ts";
import { owningBot } from "../conversations.ts";
import type { Files } from "../files.ts";
import type { McpConnection, McpConnections } from "../mcp/connections.ts";
import {
  MemoryDoc,
  MemoryReviewDoc,
  MemorySnapshotDoc,
  memoryContext,
} from "../work/memory.ts";
import {
  type RoutineRun,
  RoutinesDoc,
  transitionRun,
} from "../work/routine-state.ts";
import {
  conversationHandoff,
  handoffInstructions,
  rebuildInstructions,
  requestInstructions,
} from "./handoff.ts";
import { conversationHistory } from "./history.ts";
import { EngineInputs } from "./inputs.ts";
import { EngineRequestRejected } from "./json-lines.ts";
import { LiveSession, type TurnHandlers } from "./live-session.ts";
import {
  mcpReadError,
  readConfiguredMcp,
  unsupportedMcp,
} from "./mcp-catalog.ts";
import { productInstructions } from "./product-guidance.mjs";
import {
  callProductTool,
  permissionTool,
  productCatalog,
  recordToolResult,
} from "./product-tools.ts";
import {
  claudeApproval,
  claudePermission,
} from "./providers/claude-approval.ts";
import { engineProvider } from "./providers/index.ts";
import { selectSession, sessionKey } from "./sessions.ts";
import { EngineDoc, EngineInputDoc } from "./state.ts";
import { type EngineRuntime, stored } from "./task-types.ts";
import {
  type EngineAnswer,
  type EngineApproval,
  type EngineConfig,
  type EngineEvent,
  type EngineMcpCatalog,
  type EngineProcess,
  type EngineSession,
  engineLimits,
} from "./types.ts";

type Active = {
  process: EngineProcess;
  session?: EngineSession;
  controller: AbortController;
  stopping?: Promise<void>;
  inputs?: EngineInputs;
  memoryReview: boolean;
  managed?: Map<
    string,
    {
      generation: number;
      computerId: string;
      worker: EngineProcess;
      tools: import("./types.ts").ProductTool[];
    }
  >;
  approve?: (
    approval: EngineApproval,
    signal: AbortSignal,
  ) => Promise<EngineAnswer>;
  routine?: {
    update: (status: RoutineRun["status"]) => Promise<void>;
    timer?: ReturnType<typeof setTimeout>;
  };
};
export class EngineExecution {
  mcp?: McpConnections;
  readonly active = new Map<number, Active>();
  private readonly idle = new Map<
    number,
    {
      key: string;
      live: LiveSession;
      timer: ReturnType<typeof setTimeout>;
      managed: Active["managed"];
      servers: { name: string; url: string }[];
    }
  >();
  readonly computers: Computers;
  readonly files?: Files;
  computer!: ComputerRuntime;
  constructor(computers: Computers, files?: Files) {
    this.computers = computers;
    this.files = files;
    computers.onIdle = (botId) => this.closeIdle(botId);
  }

  async nativeCatalog(
    botId: number,
    config: EngineConfig,
    context: Context,
    signal?: AbortSignal,
    configuration = false,
  ): Promise<EngineMcpCatalog> {
    signal = signal ?? context.abortSignal;
    signal?.throwIfAborted();
    const deadline = AbortSignal.any([
      ...(signal ? [signal] : []),
      AbortSignal.timeout(engineLimits.handshakeMs),
    ]);
    const active = this.active.get(botId);
    const retained = this.idle.get(botId);
    const session = active
      ? active.session
      : retained?.live.closed
        ? undefined
        : retained?.live.session;
    if (!configuration && session) {
      if (!session.mcp)
        return { ...unsupportedMcp(), scope: "session", sessionId: session.id };
      const cancelled = Promise.withResolvers<never>();
      const abort = () => cancelled.reject(deadline.reason);
      deadline.addEventListener("abort", abort, { once: true });
      try {
        const catalog = await Promise.race([
          session.mcp(deadline),
          cancelled.promise,
        ]);
        deadline.throwIfAborted();
        const mounted = active?.managed ?? retained?.managed;
        return {
          ...catalog,
          sessionId: session.id,
          items: catalog.items.filter(
            (item) =>
              ![...(mounted?.keys() ?? [])].some(
                (id) => item.name === `domos_${id}`,
              ),
          ),
        };
      } catch (error) {
        signal?.throwIfAborted();
        return { ...mcpReadError(error, "session"), sessionId: session.id };
      } finally {
        deadline.removeEventListener("abort", abort);
      }
    }
    const provider = engineProvider(config.provider);
    if (!provider.mcp) return unsupportedMcp();
    let worker: EngineProcess | undefined;
    const cancel = () => {
      void worker?.close();
    };
    deadline.addEventListener("abort", cancel, { once: true });
    try {
      worker = await this.computers.process(
        botId,
        [],
        async () => {
          throw new Error("目录读取不调用工具。");
        },
        context,
      );
      deadline.throwIfAborted();
      const catalog = await readConfiguredMcp(provider, worker, config);
      deadline.throwIfAborted();
      return catalog;
    } catch (error) {
      signal?.throwIfAborted();
      return mcpReadError(error, "configuration");
    } finally {
      deadline.removeEventListener("abort", cancel);
      await worker?.close();
    }
  }

  mcpExtension() {
    const validator = new AjvJsonSchemaValidator();
    return defineExtension({
      name: "domos-mcp",
      tools: [
        defineTool({
          name: "mcp_call",
          description:
            "Execute an authorized MCP request through its current connection.",
          parameters: Type.Object({
            id: Type.String(),
            requestId: Type.String(),
            method: Type.String(),
            params: Type.Record(Type.String(), Type.Unknown()),
          }),
          executionMode: "sequential",
          execute: async (input, api, ctx) => {
            const active = this.active.get(api.conversationId);
            const ownerId = await owningBot(api, api.conversationId, ctx);
            const connections = this.mcp;
            if (!connections || !active?.approve)
              throw new Error("MCP 会话已结束或未授权。");
            const signal = AbortSignal.any([
              ctx.abortSignal ?? active.controller.signal,
              active.controller.signal,
            ]);
            if (input.method === "tools/list") {
              const item = (await connections.list(ctx)).find(
                (item) => item.id === input.id,
              );
              if (!item) throw new Error("连接不存在。");
              if (active.managed?.get(item.id)?.generation !== item.generation)
                await this.connectManaged(
                  api.conversationId,
                  item,
                  ctx,
                  signal,
                );
            }
            const mounted = active.managed?.get(input.id);
            if (!mounted?.worker.mcp)
              throw new Error("请先读取此连接的 tools/list。");
            const authorize = async () => {
              const current = await connections.resolve(
                input.id,
                ownerId,
                mounted.computerId,
                ctx,
              );
              if (current.connection.generation !== mounted.generation)
                throw new Error("MCP 配置或权限已更改。请开始下一轮任务。");
              if (input.method === "tools/call") {
                const tool = mounted.tools.find(
                  (tool) => tool.name === input.params.name,
                );
                if (
                  !tool ||
                  (current.tools && !current.tools.includes(tool.name))
                )
                  throw new Error("MCP 工具未授权。");
                const checked = validator.getValidator(tool.inputSchema)(
                  input.params.arguments ?? {},
                );
                if (!checked.valid) throw new Error(checked.errorMessage);
              }
              signal.throwIfAborted();
              return current;
            };
            const current = await authorize();
            if (
              ![
                "tools/list",
                "resources/list",
                "resources/templates/list",
                "prompts/list",
              ].includes(input.method)
            ) {
              const answer = await active.approve(
                {
                  id: `mcp:${api.callId}`,
                  title: `${current.connection.name} · ${String(input.params.name ?? input.method)}`,
                  detail: "",
                  fields: Object.entries(input.params).map(
                    ([label, value]) => ({
                      label,
                      value:
                        typeof value === "string"
                          ? value
                          : (JSON.stringify(value) ?? ""),
                    }),
                  ),
                  kind: "permission",
                  automatic: true,
                },
                signal,
              );
              if (!answer.allow) throw new Error("用户拒绝此 MCP 请求。");
            }
            await authorize();
            const response = await mounted.worker.mcp<{
              result: import("./types.ts").ProductResult;
              oauth: Record<string, unknown>;
            }>(
              {
                action: "request",
                id: input.id,
                method: input.method,
                params: input.params,
              },
              signal,
              (progress) => {
                void active.process
                  .mcp?.(
                    {
                      action: "progress",
                      requestId: input.requestId,
                      progress,
                    },
                    signal,
                  )
                  .catch(() => {});
              },
            );
            await connections
              .saveOAuth(input.id, mounted.generation, response.oauth, ctx)
              .catch(() => {});
            if (input.method === "tools/list") {
              const list = response.result as unknown as {
                tools: import("./types.ts").ProductTool[];
              };
              list.tools = list.tools.filter(
                (tool) => !current.tools || current.tools.includes(tool.name),
              );
              mounted.tools = input.params.cursor
                ? [...mounted.tools, ...list.tools]
                : list.tools;
            }
            const result =
              input.method === "tools/call"
                ? response.result
                : {
                    content: [],
                    structuredContent: { result: response.result },
                  };
            return {
              output: result.content.filter(
                (part) => part.type === "text" || part.type === "image",
              ),
              details: stored(result),
              ...(result.isError ? { isError: true } : {}),
            };
          },
        }),
      ],
    });
  }

  private async connectManaged(
    botId: number,
    item: McpConnection,
    context: Context,
    signal: AbortSignal,
  ) {
    const active = this.active.get(botId);
    const connections = this.mcp;
    if (!active?.process.mcp || !connections)
      throw new Error("MCP 会话已结束。");
    const resolved = await connections.resolve(
      item.id,
      await this.computer.owner(botId, context),
      item.computerId,
      context,
    );
    const binding = await this.computers.binding(botId, context);
    if (
      resolved.config.transport === "stdio" &&
      item.computerId !== binding.computerId
    )
      throw new Error(`MCP ${item.name} 只能在绑定的工作电脑使用。`);
    const previous = active.managed?.get(item.id);
    if (previous) {
      if (previous.worker !== active.process) await previous.worker.close();
      else
        await previous.worker.mcp?.(
          { action: "disconnect", id: item.id },
          signal,
        );
      active.managed?.delete(item.id);
    }
    let worker: EngineProcess | undefined;
    try {
      worker =
        item.computerId === binding.computerId
          ? active.process
          : await this.computers.mcpProcess(item.computerId, context, botId);
      if (!worker.mcp) throw new Error("工作电脑需要更新 MCP 支持。");
      active.managed ??= new Map();
      active.managed.set(item.id, {
        generation: item.generation,
        computerId: item.computerId,
        worker,
        tools: [],
      });
      if (worker !== active.process)
        worker.mcpNotification = (id, notification) => {
          void active.process
            .mcp?.(
              { action: "notify", id, notification },
              active.controller.signal,
            )
            .catch(() => {});
        };
      const connected = await worker.mcp<{
        tools: import("./types.ts").ProductTool[];
        capabilities: Record<string, unknown>;
        oauth: Record<string, unknown>;
      }>({ action: "connect", id: item.id, ...resolved }, signal);
      signal.throwIfAborted();
      await connections.report(item.id, item.revision, connected, context);
      await connections.saveOAuth(
        item.id,
        item.generation,
        connected.oauth,
        context,
      );
      const tools = connected.tools.filter(
        (tool) => !resolved.tools || resolved.tools.includes(tool.name),
      );
      active.managed.set(item.id, {
        generation: item.generation,
        computerId: item.computerId,
        worker,
        tools,
      });
      return { tools, capabilities: connected.capabilities };
    } catch (error) {
      active.managed?.delete(item.id);
      if (worker && worker !== active.process) await worker.close();
      throw error;
    }
  }

  async run(
    runtime: EngineRuntime,
    text: string,
    context: Context,
    emit: (event: EngineEvent) => Promise<void>,
    attachments: readonly Attachment[] = [],
    operation?: "compact",
    memoryReview = false,
    routineRunId?: string,
  ) {
    const doc = await runtime.snapshot(
      EngineDoc,
      runtime.conversationId,
      context,
    );
    if (!doc) throw new Error("Bot 的任务配置不存在。");
    const botId = await owningBot(runtime, runtime.conversationId, context);
    const provider = engineProvider(doc.config.provider);
    const approve = async (
      approval: EngineApproval,
      signal: AbortSignal,
    ): Promise<EngineAnswer> => {
      if (!memoryReview) await emit({ type: "approval", approval });
      try {
        return await (memoryReview
          ? {
              allow:
                provider.id === "codex" &&
                approval.automatic === true &&
                approval.detail.startsWith("domos\n"),
            }
          : this.computer.approve(
              runtime.conversationId,
              approval,
              signal,
              context,
            ));
      } finally {
        if (!memoryReview)
          await emit({ type: "approval_closed", id: approval.id });
      }
    };
    const catalog = await productCatalog(runtime, context);
    const tools = memoryReview
      ? catalog.filter((tool) => tool.name.startsWith("memory_"))
      : catalog;
    const computerNames = new Set(
      (
        await runtime.snapshot(
          ComputerRequests,
          runtime.conversationId,
          context,
        )
      )?.tools?.map((tool) => tool.name),
    );
    const computerTools = tools.filter((tool) => computerNames.has(tool.name));
    if (provider.id === "claude") tools.push(permissionTool);
    const managed =
      !memoryReview && this.mcp
        ? (await this.mcp.list(context)).filter(
            (item) =>
              item.enabled &&
              item.grants.some((grant) => grant.botId === botId),
          )
        : [];
    const inherited =
      !memoryReview && this.mcp
        ? await this.mcp.native(botId, context)
        : !memoryReview;
    const agent = await runtime.agent(context);
    const env = await runtime.env(context);
    const sections = Object.fromEntries(
      await Promise.all(
        agent.sections
          .filter((section) => section.key !== "workspace")
          .map(async (section) => [
            section.key,
            (await section.render(
              {
                conversationId: runtime.conversationId,
                agent,
                env,
                shown: {},
                read: runtime,
              },
              context,
            )) ?? "",
          ]),
      ),
    );
    let snapshot = await runtime.snapshot(
      MemorySnapshotDoc,
      runtime.taskId,
      context,
    );
    if (!snapshot) {
      const memories = await runtime.snapshot(MemoryDoc, context);
      const text = memoryContext(memories?.items ?? [], botId);
      await runtime.commit(async (tx) => {
        (await tx.doc(MemorySnapshotDoc, runtime.taskId)).text = text ?? "";
      }, context);
      snapshot = { text: text ?? "" };
    }
    sections.memory = snapshot.text;
    const instructions = memoryReview
      ? `Review the recent conversation. Save only durable facts. Put cross-task user facts in profile and task-specific procedures in work notes. Keep facts declarative. Do not change or delete user-authored memories. Use only memory tools.\n\n${sections.memory ?? ""}`
      : [
          agent.instructions,
          ...Object.values(sections),
          "Use your native tools for commands and files in this Bot's work directory. Bots sharing this computer share OS permissions and accessible files.",
          productInstructions(tools),
          computerInstructions(computerTools),
        ]
          .filter(Boolean)
          .join("\n\n");
    if (!memoryReview)
      await runtime.commit(async (tx) => {
        (await tx.doc(EngineDoc, runtime.conversationId)).prompt = {
          text: instructions,
          sections,
          tools: tools.map((tool) => tool.name),
        };
      }, context);
    let reviewCalls = 0;
    const invoke: TurnHandlers["invoke"] = async (
      callId,
      name,
      args,
      signal,
    ) => {
      const combined = AbortSignal.any([
        signal,
        runtime.signal,
        active.controller.signal,
      ]);
      combined.throwIfAborted();
      if (name !== "approve") {
        if (memoryReview && !name.startsWith("memory_"))
          throw new Error("后台回顾只能调用记忆工具。");
        if (memoryReview && ++reviewCalls > 12)
          throw new Error("本次回顾已达到工具调用上限。");
        const computerTool = computerTools.find((tool) => tool.name === name);
        const result = computerTool
          ? await this.computer.call(
              runtime.conversationId,
              runtime.taskId,
              callId,
              computerTool,
              args,
              combined,
              context,
            )
          : await callProductTool(
              runtime,
              callId,
              name,
              args,
              context,
              combined,
            );
        return name === "conversation_read"
          ? result
          : recordToolResult(runtime, callId, name, result, context);
      }
      if (provider.id !== "claude") throw new Error("确认方式不可用。");
      const id = randomUUID();
      const approval = claudeApproval(id, args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              claudePermission(
                args,
                memoryReview
                  ? {
                      allow: tools.some(
                        (tool) =>
                          tool.name.startsWith("memory_") &&
                          args.tool_name === `mcp__domos__${tool.name}`,
                      ),
                    }
                  : await approve(approval, combined),
              ),
            ),
          },
        ],
      };
    };
    const binding = await this.computers.binding(
      runtime.conversationId,
      context,
    );
    const connectionKey = JSON.stringify([
      doc.computerId,
      binding.directory,
      doc.config,
      instructions,
      tools,
      managed.map(({ id, revision }) => [id, revision]),
      inherited,
    ]);
    const retained = this.idle.get(runtime.conversationId);
    this.idle.delete(runtime.conversationId);
    clearTimeout(retained?.timer);
    let live = retained?.live;
    if (
      live &&
      (memoryReview ||
        retained?.key !== connectionKey ||
        live.closed ||
        live.account !== (await live.process.account?.(doc.config.provider)))
    ) {
      await live.process.close();
      live = undefined;
    }
    live ??= new LiveSession();
    if (!live.process)
      await live.start((invoke) =>
        this.computers.process(runtime.conversationId, tools, invoke, context),
      );
    const connection = live;
    const active: Active = {
      memoryReview,
      approve,
      process: connection.process,
      controller: new AbortController(),
    };
    const servers = retained?.live === connection ? retained.servers : [];
    const mcpNotices: Record<string, string> = {};
    try {
      runtime.signal.throwIfAborted();
      const current = await runtime.snapshot(
        EngineDoc,
        runtime.conversationId,
        context,
      );
      if (!memoryReview && current?.activeId !== runtime.taskId)
        throw new Error("工作已停止。");
    } catch (error) {
      void (active.process.terminate?.() ?? active.process.close()).catch(
        () => {},
      );
      throw error;
    }
    this.active.set(runtime.conversationId, active);
    const interrupted = () => {
      void this.stop(runtime.conversationId);
    };
    runtime.signal.addEventListener("abort", interrupted, { once: true });
    let receiving = true;
    const initialized = Promise.withResolvers<EngineSession | null>();
    const closedApprovals = new Set<string>();
    let completed = false;
    try {
      active.managed =
        (retained?.live === connection ? retained.managed : undefined) ??
        new Map();
      if (managed.length && retained?.live !== connection) {
        const connections = this.mcp;
        if (!connections) throw new Error("连接服务不可用。");
        if (!active.process.mcp) throw new Error("工作电脑需要更新 MCP 支持。");
        const native = inherited
          ? await this.nativeCatalog(
              runtime.conversationId,
              doc.config,
              context,
              active.controller.signal,
              true,
            )
          : null;
        for (const item of managed) {
          if (
            (provider.id !== "claude" || inherited) &&
            native?.items.some(
              (entry) =>
                entry.enabled !== false &&
                entry.name.toLowerCase() === item.name.toLowerCase(),
            )
          )
            throw new Error(
              `MCP ${item.name} 与原生来源同名。请为此 Bot 选择原生连接，或先在原生程序停用该连接。`,
            );
          try {
            if (native && native.status !== "complete")
              throw new Error("原生 MCP 目录未完整读取，无法核对同名连接。");
            const connected = await this.connectManaged(
              runtime.conversationId,
              item,
              context,
              active.controller.signal,
            );
            const mounted = await active.process.mcp<{ url: string }>(
              { action: "mount", id: item.id, name: item.name, ...connected },
              active.controller.signal,
            );
            servers.push({ name: `domos_${item.id}`, url: mounted.url });
          } catch (error) {
            active.controller.signal.throwIfAborted();
            await connections.report(
              item.id,
              item.revision,
              { error },
              context,
            );
            mcpNotices[`mcp:${item.id}`] =
              native && native.status !== "complete"
                ? `MCP ${item.name} 本轮未加载。原生目录未完整读取，无法核对同名连接。请刷新原生目录后重试。本轮将继续。`
                : `MCP ${item.name} 暂不可用。本轮将继续。可使用 request_credentials 完成配置，再通过 mcp_call 读取工具。`;
          }
        }
      }
      if (routineRunId) {
        const clock: NonNullable<Active["routine"]> = {
          update: async (status) => {
            clearTimeout(active.routine?.timer);
            let remaining: number | null = null;
            await runtime.commit(async (tx) => {
              const run = (await tx.doc(RoutinesDoc)).runs.find(
                (run) => run.id === routineRunId,
              );
              if (!run || this.active.get(runtime.conversationId) !== active)
                return;
              transitionRun(run, status, Date.now());
              remaining = (run.executionMs ?? 900_000) - (run.activeMs ?? 0);
            }, context);
            if (
              status === "running" &&
              remaining !== null &&
              this.active.get(runtime.conversationId) === active
            ) {
              clock.timer = setTimeout(
                () => {
                  if (this.active.get(runtime.conversationId) === active)
                    void this.stop(
                      runtime.conversationId,
                      new Error("定时任务已达到执行期限。"),
                    );
                },
                Math.max(0, remaining),
              );
              clock.timer.unref();
            }
          },
        };
        active.routine = clock;
        await clock.update("running");
      }
      runtime.signal.throwIfAborted();
      const account = await active.process.account?.(doc.config.provider);
      if (account === undefined)
        throw new Error("工作电脑尚未提供账号隔离标识。");
      connection.account = account;
      const key = sessionKey(
        doc.computerId,
        doc.config,
        managed.length || !inherited
          ? JSON.stringify([
              account,
              managed.map(({ id, revision }) => [id, revision]),
              inherited,
            ])
          : account,
        (await this.computers.binding(runtime.conversationId, context))
          .directory,
        JSON.stringify([productInstructions(tools), tools]),
      );
      if (
        !memoryReview &&
        doc.dispatch !== "ready" &&
        doc.sessionKey &&
        doc.sessionKey !== key
      )
        throw new Error("会话配置已变化。原任务执行结果未确认，请先检查结果。");
      if (!memoryReview) {
        await runtime.commit(async (tx) => {
          selectSession(await tx.doc(EngineDoc, runtime.conversationId), key);
        }, context);
        Object.assign(
          doc,
          await runtime.snapshot(EngineDoc, runtime.conversationId, context),
        );
      }
      const resumed = Boolean(doc.sessionId);
      connection.handlers = {
        invoke,
        approve: (approval) => approve(approval, active.controller.signal),
        emit: async (event) => {
          if (!receiving || active.controller.signal.aborted) return;
          if (event.type === "approval_closed") {
            closedApprovals.add(event.id);
            this.computer.expire(runtime.conversationId, event.id);
          }
          if (event.type === "approval") {
            void approve(event.approval, active.controller.signal)
              .then(async (answer) => {
                const session = await initialized.promise;
                if (
                  receiving &&
                  !active.controller.signal.aborted &&
                  !closedApprovals.has(event.approval.id)
                )
                  await session?.answer(event.approval.id, answer);
              })
              .catch(() => {
                if (this.active.get(runtime.conversationId) === active)
                  return this.stop(runtime.conversationId);
              });
            return;
          }
          if (memoryReview) {
            if (event.type === "usage") await emit(event);
            if (event.type === "session" || event.type === "accepted")
              await runtime.commit(async (tx) => {
                const saved = await tx.doc(MemorySnapshotDoc, runtime.taskId);
                if (event.type === "session") saved.sessionId = event.id;
                else saved.turnId = event.id;
              }, context);
            return;
          }
          if (
            !operation ||
            event.type === "session" ||
            event.type === "runtime" ||
            event.type === "context" ||
            event.type === "compaction" ||
            event.type === "usage" ||
            event.type === "approval_closed" ||
            event.type === "accepted"
          )
            await emit(event);
          if (event.type === "accepted" && event.ready !== false)
            active.inputs?.start();
        },
      };
      active.session = await connection.initialize({
        mcp: { servers, inheritNative: inherited },
        config: doc.config,
        sessionId: memoryReview ? (snapshot.sessionId ?? null) : doc.sessionId,
        instructions,
      });
      if (active.managed?.size && inherited) {
        const native = await this.nativeCatalog(
          runtime.conversationId,
          doc.config,
          context,
          active.controller.signal,
        );
        for (const item of managed) {
          if (
            active.managed.has(item.id) &&
            native.items.some(
              (entry) =>
                entry.enabled !== false &&
                entry.name.toLowerCase() === item.name.toLowerCase(),
            )
          )
            throw new Error(
              `MCP ${item.name} 与当前会话的原生来源同名。请先选择连接来源。`,
            );
        }
        if (native.status !== "complete")
          mcpNotices["mcp:catalog"] =
            "当前会话的原生 MCP 目录未完整读取。已保留启动前的配置检查结果。";
      }
      if (Object.keys(mcpNotices).length)
        await emit({ type: "runtime", state: { notices: mcpNotices } });
      initialized.resolve(active.session);
      await active.session.ready?.();
      if (provider.toolDiscovery !== "prompt")
        await active.process.toolsReady?.();
      if (memoryReview) {
        if (snapshot.dispatched) {
          if (!(await active.session.recover?.(snapshot.turnId ?? null)))
            throw new Error("回顾结果未确认，不重复发送。");
          return;
        }
        const review = await runtime.snapshot(
          MemoryReviewDoc,
          runtime.conversationId,
          context,
        );
        const history = await conversationHistory(
          runtime,
          null,
          context,
          review?.through ?? null,
          undefined,
          6000,
          "omit",
        );
        await runtime.commit(async (tx) => {
          (await tx.doc(MemorySnapshotDoc, runtime.taskId)).dispatched = true;
        }, context);
        const timer = setTimeout(() => {
          void this.stop(runtime.conversationId);
        }, engineLimits.compactionMs);
        try {
          await active.session.prompt(
            `Quoted conversation data for memory review:\n${history ?? "{}"}`,
          );
          active.controller.signal.throwIfAborted();
        } finally {
          clearTimeout(timer);
        }
        return;
      }
      if (operation === "compact") {
        const compactSession = active.session.compact;
        if (!compactSession) throw new Error("此引擎没有提供压缩能力。");
        const timeout = Promise.withResolvers<never>();
        const timer = setTimeout(
          () =>
            timeout.reject(
              new Error("压缩等待超时。结果未确认，请核对原生会话。"),
            ),
          engineLimits.compactionMs,
        );
        timer.unref();
        const compact = async () => {
          if (doc.dispatch !== "ready") {
            if (await active.session?.recoverCompaction?.(doc.turnId)) {
              await emit({ type: "compaction", status: "completed" });
              return;
            }
            throw new Error(
              "压缩结果未确认。请先检查原生会话，再决定是否重试。",
            );
          }
          await emit({
            type: "compaction",
            status: "running",
            trigger: "manual",
          });
          await runtime.commit(async (tx) => {
            (await tx.doc(EngineDoc, runtime.conversationId)).dispatch =
              "sending";
          }, context);
          await compactSession();
        };
        try {
          await Promise.race([compact(), timeout.promise]);
        } catch (error) {
          clearTimeout(active.routine?.timer);
          receiving = false;
          const state = await runtime.snapshot(
            EngineDoc,
            runtime.conversationId,
            context,
          );
          if (
            state?.runtime?.compaction !== "completed" &&
            state?.runtime?.compaction !== "failed"
          )
            await emit({
              type: "compaction",
              status:
                error instanceof EngineRequestRejected ? "failed" : "uncertain",
              error:
                error instanceof Error ? error.message : "压缩结果未确认。",
            });
          throw error;
        } finally {
          clearTimeout(timer);
        }
        return;
      }
      if (doc.dispatch !== "ready") {
        let inputCount = 1;
        await runtime.commit(async (tx) => {
          for (const id of doc.tasks) {
            const input = await tx.doc(EngineInputDoc, id);
            if (input.owner === runtime.taskId && input.status === "accepted")
              inputCount++;
          }
        }, context);
        if (!(await active.session.recover?.(doc.turnId, inputCount)))
          throw new Error(
            "执行结果未确认。请先检查文件和任务结果，再决定是否重试。",
          );
        return;
      }
      void active.session
        .skills?.()
        .then(async (nativeSkills) => {
          if (nativeSkills && receiving && !active.controller.signal.aborted)
            await emit({ type: "runtime", state: { nativeSkills } });
        })
        .catch(async (error) => {
          if (receiving && !active.controller.signal.aborted)
            await emit({
              type: "runtime",
              state: {
                notices: { skills: `原生技能目录读取失败：${String(error)}` },
              },
            });
        });
      active.inputs = new EngineInputs(
        runtime,
        active.session,
        this.files,
        context,
      );
      const images =
        (await this.files?.images(botId, attachments, context)) ?? [];
      Object.assign(
        doc,
        await runtime.snapshot(EngineDoc, runtime.conversationId, context),
      );
      const handoff = await conversationHandoff(
        runtime,
        doc.activeTurn,
        context,
        resumed ? (doc.sessions?.[key]?.through ?? null) : null,
        engineLimits.historyCharacters,
        doc.summary,
        resumed ? (doc.sessions?.[key]?.teamThrough ?? null) : null,
        !resumed,
      );
      runtime.signal.throwIfAborted();
      active.controller.signal.throwIfAborted();
      const history = handoff.history;
      await runtime.commit(async (tx) => {
        const saved = await tx.doc(EngineDoc, runtime.conversationId);
        if (saved.activeId !== runtime.taskId) throw new Error("工作已停止。");
        saved.dispatch = "sending";
      }, context);
      await emit({
        type: "runtime",
        state: {
          notices: {
            handoff: resumed
              ? "继续原生会话，补充尚未收到的消息。"
              : (handoff.notice ??
                (history ? "已交接聊天原文。原始记录仍可查询。" : "")),
          },
        },
      });
      const cancelled = Promise.withResolvers<never>();
      const abort = () => cancelled.reject(active.controller.signal.reason);
      active.controller.signal.addEventListener("abort", abort, { once: true });
      try {
        active.controller.signal.throwIfAborted();
        await Promise.race([
          active.session.prompt(
            history
              ? `${handoffInstructions}${resumed ? "" : rebuildInstructions}${history}${requestInstructions}${text}`
              : text,
            images,
          ),
          cancelled.promise,
        ]);
        completed = true;
      } finally {
        active.controller.signal.removeEventListener("abort", abort);
      }
    } finally {
      clearTimeout(active.routine?.timer);
      receiving = false;
      initialized.resolve(null);
      active.controller.abort();
      for (const mounted of active.managed?.values() ?? [])
        if (mounted.worker !== active.process) void mounted.worker.close();
      runtime.signal.removeEventListener("abort", interrupted);
      if (active.stopping) {
        connection.release();
        void active.inputs?.close().catch(() => {});
      } else {
        await active.inputs?.close();
        if (
          completed &&
          !memoryReview &&
          active.managed?.size === managed.length &&
          [...(active.managed?.values() ?? [])].every(
            (mounted) => mounted.worker === active.process,
          ) &&
          [
            "codex",
            "claude",
            "pi",
            "grok",
            "antigravity",
            "devin",
            "cursor",
          ].includes(provider.id) &&
          connection.release()
        ) {
          const timer = setTimeout(() => {
            if (this.idle.get(runtime.conversationId)?.live === connection)
              void this.closeIdle(runtime.conversationId);
          }, engineLimits.idleMs);
          timer.unref();
          this.idle.set(runtime.conversationId, {
            key: connectionKey,
            live: connection,
            timer,
            managed: active.managed,
            servers,
          });
          void active.process.closed.then(() => {
            if (this.idle.get(runtime.conversationId)?.live === connection) {
              clearTimeout(timer);
              this.idle.delete(runtime.conversationId);
            }
          });
        } else {
          connection.release();
          await active.process.close();
        }
      }
      if (this.active.get(runtime.conversationId) === active) {
        this.active.delete(runtime.conversationId);
        this.computers.tools.finish(`computer:${runtime.conversationId}`);
      }
    }
  }

  async closeIdle(botId: number) {
    const retained = this.idle.get(botId);
    if (!retained) return;
    this.idle.delete(botId);
    clearTimeout(retained.timer);
    await retained.live.process.close();
  }

  deliver(botId: number) {
    this.active.get(botId)?.inputs?.notify();
  }

  stopMemoryReview(botId: number) {
    return this.active.get(botId)?.memoryReview
      ? this.stop(botId)
      : Promise.resolve();
  }

  async waiting(
    botId: number,
    status: "running" | "waiting_answer" | "waiting_approval",
  ) {
    await this.active.get(botId)?.routine?.update(status);
  }

  stop(botId: number, reason?: Error) {
    const active = this.active.get(botId);
    if (!active) return this.closeIdle(botId);
    clearTimeout(active.routine?.timer);
    active.controller.abort(reason);
    this.active.delete(botId);
    this.computers.tools.finish(`computer:${botId}`);
    void active.session?.interrupt().catch(() => {});
    active.stopping ??= (
      active.process.terminate?.() ?? active.process.close()
    ).catch(() => {});
    return Promise.resolve();
  }

  takeRequest(botId: number, id: string, view: string, context: Context) {
    return this.computer.takeRequest(botId, id, view, context);
  }

  answer(botId: number, id: string, answer: EngineAnswer, context: Context) {
    return this.computer.answer(botId, id, answer, context);
  }
}
