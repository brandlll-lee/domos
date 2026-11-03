import { randomUUID } from "node:crypto";
import type { Context } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { Attachment } from "../attachments.ts";
import type { Computers } from "../computer/catalog.ts";
import { computerInstructions } from "../computer/instructions.ts";
import { ComputerRequests, type ComputerRuntime } from "../computer/runtime.ts";
import type { Files } from "../files.ts";
import type { McpConnections } from "../mcp/connections.ts";
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
  handoffBudget,
  handoffInstructions,
  requestInstructions,
} from "./budget.ts";
import { conversationHistory } from "./history.ts";
import { EngineInputs } from "./inputs.ts";
import { EngineRequestRejected } from "./json-lines.ts";
import {
  callProductTool,
  permissionTool,
  productCatalog,
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
  type EngineEvent,
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
  readonly computers: Computers;
  readonly files?: Files;
  computer!: ComputerRuntime;
  constructor(computers: Computers, files?: Files) {
    this.computers = computers;
    this.files = files;
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
            const mounted = active?.managed?.get(input.id);
            const connections = this.mcp;
            if (!connections || !active?.approve || !mounted?.worker.mcp)
              throw new Error("MCP 会话已结束或未授权。");
            const signal = AbortSignal.any([
              ctx.abortSignal ?? active.controller.signal,
              active.controller.signal,
            ]);
            const authorize = async () => {
              const current = await connections.resolve(
                input.id,
                api.conversationId,
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
    let reviewCalls = 0;
    const active: Active = {
      memoryReview,
      approve,
      process: await this.computers.process(
        runtime.conversationId,
        tools,
        async (callId, name, args, signal) => {
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
            const computerTool = computerTools.find(
              (tool) => tool.name === name,
            );
            if (computerTool)
              return this.computer.call(
                runtime.conversationId,
                runtime.taskId,
                callId,
                computerTool,
                args,
                combined,
                context,
              );
            return callProductTool(
              runtime,
              callId,
              name,
              args,
              context,
              combined,
            );
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
        },
        context,
      ),
      controller: new AbortController(),
    };
    const managed =
      !memoryReview && this.mcp
        ? (await this.mcp.list(context)).filter(
            (item) =>
              item.enabled &&
              item.grants.some(
                (grant) => grant.botId === runtime.conversationId,
              ),
          )
        : [];
    const inherited =
      !memoryReview && this.mcp
        ? await this.mcp.native(runtime.conversationId, context)
        : !memoryReview;
    const servers: { name: string; url: string }[] = [];
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
    try {
      active.managed = new Map();
      if (managed.length) {
        const connections = this.mcp;
        if (!connections) throw new Error("连接服务不可用。");
        if (!active.process.mcp) throw new Error("工作电脑需要更新 MCP 支持。");
        const native = await active.process.mcp<{
          items: { name: string; enabled: boolean }[];
        }>({ action: "native", config: doc.config }, active.controller.signal);
        for (const item of managed) {
          if (
            (provider.id !== "claude" || inherited) &&
            native.items.some(
              (entry) =>
                entry.enabled &&
                entry.name.toLowerCase() === item.name.toLowerCase(),
            )
          )
            throw new Error(
              `MCP ${item.name} 与原生来源同名。请为此 Bot 选择原生连接，或先在原生程序停用该连接。`,
            );
          const resolved = await connections.resolve(
            item.id,
            runtime.conversationId,
            item.computerId,
            context,
          );
          if (
            resolved.config.transport === "stdio" &&
            item.computerId !== doc.computerId
          )
            throw new Error(`MCP ${item.name} 只能在绑定的工作电脑使用。`);
          const worker =
            item.computerId === doc.computerId
              ? active.process
              : await this.computers.mcpProcess(
                  item.computerId,
                  context,
                  runtime.conversationId,
                );
          if (!worker.mcp) throw new Error("工作电脑需要更新 MCP 支持。");
          const connection = {
            generation: item.generation,
            computerId: item.computerId,
            worker,
            tools: [] as import("./types.ts").ProductTool[],
          };
          active.managed.set(item.id, connection);
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
          }>(
            { action: "connect", id: item.id, ...resolved },
            active.controller.signal,
          );
          const tools = connected.tools.filter(
            (tool) => !resolved.tools || resolved.tools.includes(tool.name),
          );
          connection.tools = tools;
          await connections.saveOAuth(
            item.id,
            item.generation,
            connected.oauth,
            context,
          );
          const mounted = await active.process.mcp<{ url: string }>(
            {
              action: "mount",
              id: item.id,
              name: item.name,
              tools,
              capabilities: connected.capabilities,
            },
            active.controller.signal,
          );
          servers.push({ name: `domos_${item.id}`, url: mounted.url });
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
      );
      if (
        !memoryReview &&
        doc.dispatch !== "ready" &&
        doc.sessionKey &&
        doc.sessionKey !== key
      )
        throw new Error("账号配置已变化。原任务执行结果未确认，请先检查结果。");
      if (!memoryReview) {
        await runtime.commit(async (tx) => {
          selectSession(await tx.doc(EngineDoc, runtime.conversationId), key);
        }, context);
        Object.assign(
          doc,
          await runtime.snapshot(EngineDoc, runtime.conversationId, context),
        );
      }
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
        const text = memoryContext(
          memories?.items ?? [],
          runtime.conversationId,
        );
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
            "Use your native tools for commands and files in this Bot's work directory. Publish deliverable files with attach_file. Bots sharing this computer share OS permissions and accessible files.",
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
      const resumed = Boolean(doc.sessionId);
      active.session = await provider.open({
        mcp: { servers, inheritNative: inherited },
        process: active.process,
        config: doc.config,
        sessionId: memoryReview ? (snapshot.sessionId ?? null) : doc.sessionId,
        instructions,
        approve: (approval) => approve(approval, active.controller.signal),
        emit: async (event) => {
          if (!receiving || active.controller.signal.aborted) return;
          if (event.type === "approval_closed")
            this.computer.expire(runtime.conversationId, event.id);
          if (event.type === "approval") {
            void approve(event.approval, active.controller.signal)
              .then(async (answer) =>
                (await initialized.promise)?.answer(event.approval.id, answer),
              )
              .catch(() => this.stop(runtime.conversationId));
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
      });
      initialized.resolve(active.session);
      await active.session.ready?.();
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
        (await this.files?.images(
          runtime.conversationId,
          attachments,
          context,
        )) ?? [];
      Object.assign(
        doc,
        await runtime.snapshot(EngineDoc, runtime.conversationId, context),
      );
      const budget = handoffBudget(doc, instructions, text, tools, images);
      const history = await conversationHistory(
        runtime,
        doc.activeTurn,
        context,
        resumed ? (doc.sessions?.[key]?.through ?? null) : null,
        undefined,
        budget,
        "omit",
      );
      runtime.signal.throwIfAborted();
      active.controller.signal.throwIfAborted();
      await runtime.commit(async (tx) => {
        (await tx.doc(EngineDoc, runtime.conversationId)).dispatch = "sending";
      }, context);
      const cancelled = Promise.withResolvers<never>();
      const abort = () => cancelled.reject(active.controller.signal.reason);
      active.controller.signal.addEventListener("abort", abort, { once: true });
      try {
        active.controller.signal.throwIfAborted();
        await Promise.race([
          active.session.prompt(
            history
              ? `${handoffInstructions}${history}${requestInstructions}${text}`
              : text,
            images,
          ),
          cancelled.promise,
        ]);
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
        void active.inputs?.close().catch(() => {});
      } else {
        await active.inputs?.close();
        await active.process.close();
      }
      if (this.active.get(runtime.conversationId) === active) {
        this.active.delete(runtime.conversationId);
        this.computers.tools.finish(`computer:${runtime.conversationId}`);
      }
    }
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
    if (!active) return Promise.resolve();
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
