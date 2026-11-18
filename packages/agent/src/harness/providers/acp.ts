import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import {
  ClientSideConnection,
  type ContentBlock,
  type InitializeResponse,
  ndJsonStream,
  PROTOCOL_VERSION,
  type SessionConfigOption,
} from "@agentclientprotocol/sdk";
import { z } from "zod";
import { openCodeRequest } from "../http-service.mjs";
import { openOpenCodeAccount } from "../opencode-account.ts";
import {
  type EngineAnswer,
  type EngineApproval,
  type EngineConfig,
  type EngineControls,
  type EngineEvent,
  type EngineMcpCatalog,
  type EngineOpen,
  type EnginePlan,
  type EngineProvider,
  type EngineSession,
  engineLimits,
} from "../types.ts";
import { CumulativeCost } from "../usage-cost.ts";
import { answerAcpPermission } from "./acp-permission.ts";
import { AcpPrompts } from "./acp-prompts.ts";
import { acpTools } from "./acp-tools.ts";
import {
  completedCompaction,
  openCodeRecords,
  readOpenCodeMcp,
} from "./opencode-records.ts";
import { formContent, formQuestions } from "./question-form.ts";

export function acpProvider(
  descriptor: Pick<
    EngineProvider,
    "id" | "name" | "command" | "package" | "login" | "mcp" | "toolDiscovery"
  > & {
    notification?: (
      method: string,
      params: Record<string, unknown>,
      emit: EngineOpen["emit"],
      plan: Map<string, EnginePlan[number]>,
    ) => Promise<void>;
    authMethod?: string;
    sessionMcp?: (
      rpc: ClientSideConnection,
      sessionId: string,
    ) => Promise<EngineMcpCatalog>;
    promptSteering?: (
      hello: InitializeResponse,
    ) => "replace" | "append" | undefined;
    question?: (
      method: string,
      params: Record<string, unknown>,
      ask: (approval: EngineApproval) => Promise<EngineAnswer>,
    ) => Promise<Record<string, unknown>>;
    args?: (config: EngineConfig) => string[];
    mode?: (config: EngineConfig) => string | undefined;
    steer?: (
      rpc: ClientSideConnection,
      sessionId: string,
      blocks: ContentBlock[],
      requestId?: string,
    ) => Promise<"accepted" | "refused" | "uncertain">;
  },
): EngineProvider {
  const provider: EngineProvider = {
    ...descriptor,
    capabilities: {
      approvals: true,
      models: true,
      recovery: descriptor.id === "opencode",
    },
    ...(descriptor.id === "opencode"
      ? {
          async mcp({
            process,
            config,
          }: Pick<EngineOpen, "process" | "config">) {
            await openOpenCodeAccount(process, {}, config.command);
            return readOpenCodeMcp(process, "configuration");
          },
        }
      : descriptor.sessionMcp
        ? {
            async mcp(input) {
              const session = await provider.open({
                ...input,
                sessionId: null,
                instructions: "Domos native capability read.",
                emit: async () => {},
              });
              if (!session.mcp) throw new Error("原生引擎未提供 MCP 目录。");
              return session.mcp();
            },
          }
        : {}),
    async open({
      process,
      config,
      sessionId,
      instructions,
      emit,
      approve,
      env,
      mcp,
    }: EngineOpen) {
      const ready = await process.ready;
      const openCode = descriptor.id === "opencode";
      if (descriptor.id === "acp" && !config.command)
        throw new Error("请指定工作电脑上的 ACP 程序。");
      let sequence = 0;
      let active = false;
      let prompts: AcpPrompts | undefined;
      let compactionConfirmed = false;
      let compactionSummary = "";
      let compactionBoundary = "";
      let nativeCost: number | undefined;
      const cost = new CumulativeCost(Boolean(sessionId));
      const costCounter = randomUUID();
      let nativeId = sessionId;
      let contextReading: Extract<EngineEvent, { type: "context" }> | undefined;
      let turnId = "";
      let reply:
        | { id: string; nativeId?: string; text: string; published?: string }
        | undefined;
      const children = new Map<string, string>();
      const nativePlan = new Map<string, EnginePlan[number]>();
      let events = Promise.resolve();
      const publishReply = async (receivedAt?: number) => {
        if (!reply?.text.trim() || reply.text === reply.published) return;
        const { id, text } = reply;
        await emit({ type: "message", id, text, receivedAt });
        reply.published = text;
      };
      const recordTool = acpTools(emit);
      let configOptions: SessionConfigOption[] = [];
      let commands: EngineControls["commands"] = [];
      let modes:
        | {
            currentModeId: string;
            availableModes: { id: string; name: string }[];
          }
        | undefined;
      const controls = (): EngineControls => ({
        compact: commands.some((item) => item.name === "compact"),
        commands,
        options: [
          ...configOptions
            .filter(
              (item) =>
                item.category !== "model" &&
                !(descriptor.mode && item.id === "mode"),
            )
            .map((item) => ({
              id: item.id,
              ...(item.category === "thought_level"
                ? { kind: "effort" as const }
                : {}),
              label: item.name,
              value: String(item.currentValue),
              options:
                item.type === "boolean"
                  ? [
                      { id: "true", label: "开启" },
                      { id: "false", label: "关闭" },
                    ]
                  : item.options.flatMap((option) =>
                      "value" in option
                        ? [{ id: option.value, label: option.name }]
                        : option.options.map((value) => ({
                            id: value.value,
                            label: value.name,
                          })),
                    ),
            })),
          ...(modes &&
          !descriptor.mode &&
          !configOptions.some((item) => item.id === "mode")
            ? [
                {
                  id: "mode",
                  label: "工作模式",
                  value: modes.currentModeId,
                  options: modes.availableModes.map((item) => ({
                    id: item.id,
                    label: item.name,
                  })),
                },
              ]
            : []),
        ],
      });
      const pending = new Map<
        string,
        {
          validate?: (answer: EngineAnswer) => unknown;
          answer: (value: EngineAnswer) => void;
        }
      >();
      async function ask(
        approval: EngineApproval,
        validate?: (answer: EngineAnswer) => unknown,
      ) {
        if (openCode) await events.then(() => publishReply());
        const result = Promise.withResolvers<EngineAnswer>();
        pending.set(approval.id, { answer: result.resolve, validate });
        const timer = setTimeout(
          () => result.resolve({ allow: false }),
          engineLimits.approvalMs,
        );
        timer.unref();
        try {
          if (approve) {
            const answer = await approve(approval);
            if (answer.allow) validate?.(answer);
            result.resolve(answer);
          } else await emit({ type: "approval", approval });
          return await result.promise;
        } finally {
          clearTimeout(timer);
          pending.delete(approval.id);
          await emit({ type: "approval_closed", id: approval.id });
        }
      }
      void process.closed.then(() => {
        for (const item of pending.values()) item.answer({ allow: false });
      });
      const rpc = new ClientSideConnection(
        () => ({
          async extNotification(method, params) {
            if (!active || !descriptor.notification) return;
            const receivedAt = Date.now();
            events = events.then(() =>
              descriptor.notification?.(
                method,
                params,
                (event) => emit({ ...event, receivedAt }),
                nativePlan,
              ),
            );
            void events.catch(() => {});
          },
          async extMethod(method, params) {
            if (!descriptor.question)
              throw new Error("原生引擎请求了不支持的交互。");
            return descriptor.question(method, params, (approval) =>
              ask({ ...approval, id: `question:${++sequence}` }),
            );
          },
          async createElicitation(request) {
            if (request.mode !== "form")
              throw new Error("此引擎提问格式尚未支持。");
            const schema =
              request.requestedSchema as z.core.JSONSchema.JSONSchema;
            const answer = await ask(
              {
                id: `question:${++sequence}`,
                kind: "question",
                title: request.message,
                detail: "",
                questions: formQuestions(schema),
              },
              (answer) => formContent(schema, answer),
            );
            return answer.allow
              ? { action: "accept", content: formContent(schema, answer) }
              : { action: "cancel" };
          },
          requestPermission: (request) =>
            answerAcpPermission(
              request,
              config,
              `permission:${++sequence}`,
              ask,
            ),
          async sessionUpdate(notification) {
            const receivedAt = Date.now();
            const parentId = children.has(notification.sessionId)
              ? notification.sessionId
              : undefined;
            const forward = (event: EngineEvent) =>
              emit({ ...event, ...(parentId ? { parentId } : {}), receivedAt });
            events = events.then(async () => {
              const emit = forward;
              const { sessionId, update } = notification;
              if (
                nativeId &&
                sessionId !== nativeId &&
                !children.has(sessionId)
              )
                return;
              if (update.sessionUpdate === "subagent_update") {
                children.set(update.sessionId, sessionId);
                await emit({
                  type: "tool",
                  id: update.sessionId,
                  name: update.title ?? "Subagent",
                  input: { description: update.description ?? "" },
                  native: update,
                });
                await emit({
                  type: "tool_result",
                  id: update.sessionId,
                  name: update.title ?? "Subagent",
                  text: update.description ?? "",
                  failed: false,
                  partial: update.state?.state !== "idle",
                  native: update,
                });
                return;
              }
              if (parentId) {
                if (
                  (update.sessionUpdate === "agent_message_chunk" ||
                    update.sessionUpdate === "agent_thought_chunk") &&
                  update.content.type === "text"
                )
                  await emit({
                    type:
                      update.sessionUpdate === "agent_thought_chunk"
                        ? "thinking"
                        : "text",
                    id: `${sessionId}:${update.messageId ?? update.sessionUpdate}`,
                    text: update.content.text,
                    native: update,
                  });
                if (
                  update.sessionUpdate === "tool_call" ||
                  update.sessionUpdate === "tool_call_update"
                )
                  await recordTool(update, false, { receivedAt, parentId });
                return;
              }
              if (update.sessionUpdate === "usage_update") {
                if (update.cost?.currency === "USD") {
                  nativeCost = update.cost.amount;
                  if (!active) cost.read(`baseline:${nativeCost}`, nativeCost);
                }
                contextReading = {
                  type: "context",
                  tokens: update.used,
                  window: update.size,
                  source: `${descriptor.id}.acp.usage_update`,
                  basis: "window",
                  estimated: false,
                  model:
                    configOptions
                      .find((option) => option.category === "model")
                      ?.currentValue?.toString() ?? config.model,
                };
                if (nativeId) await emit(contextReading);
              }
              if (active && update.sessionUpdate === "compaction_update") {
                if (update.summary) {
                  compactionBoundary = update.compactionId;
                  compactionSummary = update.summary
                    .filter((block) => block.type === "text")
                    .map((block) => block.text)
                    .join("\n");
                }
                const status =
                  update.status === "in_progress"
                    ? "running"
                    : update.status === "completed"
                      ? "completed"
                      : update.status === "failed" ||
                          update.status === "cancelled"
                        ? "failed"
                        : null;
                if (status) {
                  compactionConfirmed = status === "completed";
                  await emit({
                    type: "compaction",
                    status,
                    nativeId: update.compactionId,
                    ...(status === "completed" &&
                    compactionSummary &&
                    compactionBoundary === update.compactionId
                      ? {
                          summary: {
                            text: compactionSummary,
                            nativeBoundary: update.compactionId,
                            retained: [],
                          },
                        }
                      : {}),
                    ...(update.error ? { error: update.error } : {}),
                  });
                }
              }
              if (
                active &&
                update.sessionUpdate === "compaction_summary_chunk"
              ) {
                if (compactionBoundary !== update.compactionId)
                  compactionSummary = "";
                compactionBoundary = update.compactionId;
                if (update.content.type === "text")
                  compactionSummary += update.content.text;
                await emit({
                  type: "compaction",
                  status: "running",
                  nativeId: update.compactionId,
                });
              }
              if (update.sessionUpdate === "notice")
                await emit({
                  type: "runtime",
                  state: {
                    notices: {
                      [update.title]: update.description ?? update.title,
                    },
                  },
                });
              if (update.sessionUpdate === "available_commands_update") {
                commands = update.availableCommands.map((item) => ({
                  name: item.name,
                  description: item.description,
                }));
                await emit({
                  type: "runtime",
                  state: {
                    controls: controls(),
                    contextPolicy: {
                      manual: controls().compact,
                      automatic: "native",
                      refresh: false,
                    },
                  },
                });
              }
              if (update.sessionUpdate === "config_option_update") {
                configOptions = update.configOptions;
                await emit({
                  type: "runtime",
                  state: { controls: controls() },
                });
              }
              if (update.sessionUpdate === "current_mode_update" && modes) {
                modes.currentModeId = update.currentModeId;
                await emit({
                  type: "runtime",
                  state: { controls: controls() },
                });
              }
              if (!active) return;
              if (
                update.sessionUpdate === "user_message_chunk" &&
                update.content.type === "text"
              )
                prompts?.observe(update.content.text);
              if (update.sessionUpdate === "plan") {
                nativePlan.clear();
                update.entries.forEach((entry, index) => {
                  nativePlan.set(String(index), {
                    step: entry.content,
                    status:
                      entry.status === "in_progress"
                        ? "inProgress"
                        : entry.status,
                  });
                });
                await emit({
                  type: "plan",
                  plan: [...nativePlan.values()],
                });
              }
              if (
                (update.sessionUpdate === "agent_message_chunk" ||
                  update.sessionUpdate === "agent_thought_chunk") &&
                update.content.type === "text"
              ) {
                if (update.sessionUpdate === "agent_message_chunk") {
                  if (
                    update.messageId &&
                    update.messageId !== reply?.nativeId
                  ) {
                    await publishReply(receivedAt);
                    reply = undefined;
                  }
                  reply ??= {
                    id: update.messageId ?? `${descriptor.id}:${++sequence}`,
                    nativeId: update.messageId ?? undefined,
                    text: "",
                  };
                  reply.text += update.content.text;
                }
                await emit({
                  type:
                    update.sessionUpdate === "agent_message_chunk"
                      ? "text"
                      : "thinking",
                  id: update.messageId ?? reply?.id ?? turnId,
                  text: update.content.text,
                });
              }
              if (
                update.sessionUpdate === "tool_call" ||
                update.sessionUpdate === "tool_call_update"
              ) {
                if (update.sessionUpdate === "tool_call") {
                  if (openCode || !reply?.nativeId)
                    await publishReply(receivedAt);
                  if (!reply?.nativeId) reply = undefined;
                }
                await recordTool(update, false, { receivedAt });
              }
            });
            void events.catch(() => {});
          },
        }),
        ndJsonStream(
          Writable.toWeb(process.input),
          Readable.toWeb(process.output) as ReadableStream<Uint8Array>,
        ),
      );
      await process.launch(
        openCode
          ? {
              command: config.command ?? descriptor.command,
              args: [
                "acp",
                "--hostname",
                "127.0.0.1",
                "--port",
                "__DOMOS_PORT__",
              ],
              http: {
                timeoutMs: engineLimits.handshakeMs,
                readyMs: engineLimits.handshakeMs,
                listen: true,
              },
              instructions,
              env: {
                ...env,
                OPENCODE_CONFIG_CONTENT: JSON.stringify({
                  instructions: [`${ready.cwd}/.domos-instructions.md`],
                  ...(config.approvalMode
                    ? {
                        permission:
                          config.approvalMode === "full" ? "allow" : "ask",
                      }
                    : {}),
                }),
              },
            }
          : {
              command: config.command || descriptor.command,
              args: config.args ?? descriptor.args?.(config) ?? [],
              env,
            },
      );
      const hello: InitializeResponse = await rpc.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          elicitation: { form: {} },
          session: {
            configOptions: { boolean: {} },
            notices: {},
            compaction: {},
          },
        },
        clientInfo: { name: "domos", version: "1.0.0" },
      });
      if (descriptor.authMethod)
        await rpc.authenticate({ methodId: descriptor.authMethod });
      const nativeInstructions = Boolean(
        hello.agentCapabilities?.sessionCapabilities?.systemPrompt,
      );
      const mcpServers = [
        { name: "domos", url: ready.url },
        ...(mcp?.servers ?? []),
      ].map(({ name, url }) => {
        if (hello.agentCapabilities?.mcpCapabilities?.http)
          return { type: "http" as const, name, url, headers: [] };
        if (!ready.mcpStdio)
          throw new Error("工作电脑需要更新 stdio MCP 支持。");
        return { ...ready.mcpStdio, name, args: [...ready.mcpStdio.args, url] };
      });
      const params = {
        cwd: ready.cwd,
        mcpServers,
        ...(nativeInstructions
          ? {
              systemPrompt: {
                mode: "append",
                content: [{ type: "text" as const, text: instructions }],
              },
            }
          : {}),
      };
      if (sessionId && !hello.agentCapabilities?.loadSession)
        throw new Error(
          `${descriptor.name} 当前版本无法恢复这个会话。请开始新会话。`,
        );
      const result = sessionId
        ? await rpc.loadSession({ ...params, sessionId })
        : await rpc.newSession(params);
      const id = sessionId ?? (result as { sessionId: string }).sessionId;
      const promptSteering = descriptor.promptSteering?.(hello);
      if (promptSteering) prompts = new AcpPrompts(rpc, id);
      configOptions = result.configOptions ?? [];
      const nativeModels = z
        .object({
          models: z
            .object({
              availableModels: z.array(
                z.object({ modelId: z.string(), name: z.string() }),
              ),
            })
            .optional(),
        })
        .parse(result).models;
      modes = result.modes ?? undefined;
      const modelOption = result.configOptions?.find(
        (item) => item.category === "model",
      );
      if (config.model && modelOption) {
        const changed = await rpc.setSessionConfigOption({
          sessionId: id,
          configId: modelOption.id,
          value: config.model,
        });
        configOptions = changed.configOptions;
      }
      if (config.model && !modelOption && nativeModels)
        await rpc.extMethod("session/set_model", {
          sessionId: id,
          modelId: config.model,
        });
      const permissionMode = descriptor.mode?.(config);
      if (permissionMode) {
        const option = configOptions.find((item) => item.id === "mode");
        if (option) {
          const changed = await rpc.setSessionConfigOption({
            sessionId: id,
            configId: option.id,
            value: permissionMode,
          });
          if (
            !changed.configOptions.some(
              (item) =>
                item.id === option.id && item.currentValue === permissionMode,
            )
          )
            throw new Error("原生引擎未确认权限模式。");
          configOptions = changed.configOptions;
        } else {
          if (!modes?.availableModes.some((item) => item.id === permissionMode))
            throw new Error("原生引擎未提供所选权限模式。");
          await rpc.setSessionMode({ sessionId: id, modeId: permissionMode });
          modes.currentModeId = permissionMode;
        }
      }
      for (const [key, value] of Object.entries(config.options ?? {})) {
        if (key === "mode" && descriptor.mode)
          throw new Error("请通过统一审批设置选择权限模式。");
        if (
          key === "mode" &&
          modes &&
          !configOptions.some((item) => item.id === key)
        ) {
          if (!modes.availableModes.some((item) => item.id === value))
            throw new Error("此引擎没有提供这个工作模式。");
          await rpc.setSessionMode({ sessionId: id, modeId: value });
          modes.currentModeId = value;
        } else {
          const option = configOptions.find((item) => item.id === key);
          if (
            !option ||
            !controls()
              .options.find((item) => item.id === key)
              ?.options.some((item) => item.id === value)
          )
            throw new Error("此引擎没有提供这个配置值。");
          const changed = await rpc.setSessionConfigOption({
            sessionId: id,
            configId: key,
            ...(option.type === "boolean"
              ? { type: "boolean", value: value === "true" }
              : { value }),
          });
          if (changed.configOptions.length)
            configOptions = changed.configOptions;
        }
      }
      await emit({ type: "session", id });
      await emit({
        type: "runtime",
        state: {
          contextPolicy: {
            manual: controls().compact,
            automatic: "native",
            refresh: false,
          },
        },
      });
      nativeId = id;
      if (contextReading) await emit(contextReading);
      const records = openCodeRecords(process, id, emit, recordTool);
      const { since, record, recordMessage } = records;
      const configuredMcp = descriptor.mcp;
      const sessionMcp = descriptor.sessionMcp;
      const messages = () =>
        openCode ? records.messages() : Promise.resolve([]);
      const session: EngineSession = {
        id,
        ...(openCode
          ? {
              mcp: (signal?: AbortSignal) =>
                readOpenCodeMcp(process, "session", signal),
            }
          : sessionMcp
            ? { mcp: () => sessionMcp(rpc, id) }
            : configuredMcp
              ? { mcp: () => configuredMcp({ process, config }) }
              : {}),
        async skills() {
          if (descriptor.id !== "opencode") return undefined;
          const items = await process.request<
            { name: string; description: string; location: string }[]
          >(...openCodeRequest("skills"));
          return items.map((item) => ({
            name: item.name,
            description: item.description,
            path: item.location,
            source: "opencode",
          }));
        },
        controls: async () => ({
          ...controls(),
          skills: await session.skills?.(),
        }),
        async compact() {
          if (!controls().compact) throw new Error("此引擎尚未提供压缩命令。");
          compactionConfirmed = false;
          await session.prompt("/compact");
          if (!compactionConfirmed)
            throw new Error(
              `${descriptor.name} 没有返回压缩完成记录。结果未确认。`,
            );
        },
        async recoverCompaction(cursor) {
          if (!openCode || !cursor?.startsWith("opencode:")) return false;
          const history = await messages();
          const baseline = cursor.slice(9);
          const turn = since(history, baseline);
          if (!turn) return false;
          const compacted = completedCompaction(turn);
          if (!compacted) return false;
          await emit({
            type: "compaction",
            status: "completed",
            nativeId: compacted.info.id,
          });
          if (contextReading) await emit(contextReading);
          return true;
        },
        authenticated: async () => true,
        vision: async () =>
          hello.agentCapabilities?.promptCapabilities?.image ? null : false,
        models: async () =>
          modelOption?.type === "select"
            ? modelOption.options.flatMap((item) =>
                "value" in item
                  ? [{ id: item.value, name: item.name }]
                  : item.options.map((option) => ({
                      id: option.value,
                      name: option.name,
                    })),
              )
            : (nativeModels?.availableModels.map((item) => ({
                id: item.modelId,
                name: item.name,
              })) ?? []),
        ...(descriptor.steer || promptSteering
          ? {
              async steer(
                text: string,
                images: import("../types.ts").EngineImage[] = [],
                requestId?: string,
              ) {
                if (
                  !active ||
                  pending.size ||
                  (images.length &&
                    !hello.agentCapabilities?.promptCapabilities?.image)
                )
                  return "refused" as const;
                if (prompts)
                  return prompts.steer(
                    [{ type: "text", text }, ...images],
                    promptSteering === "replace",
                  );
                return (
                  descriptor.steer?.(
                    rpc,
                    id,
                    [{ type: "text", text }, ...images],
                    requestId,
                  ) ?? "refused"
                );
              },
            }
          : {}),
        async prompt(text, images = []) {
          if (
            images.length &&
            !hello.agentCapabilities?.promptCapabilities?.image
          )
            throw new Error(
              "当前引擎协议不支持图片。请更换引擎或使用文本资料。",
            );
          active = true;
          nativeCost = undefined;
          turnId = `${descriptor.id}:${++sequence}`;
          reply = undefined;
          const baseline = openCode
            ? `time:${await process.checkpoint?.("opencode", id)}`
            : "";
          await emit({
            type: "accepted",
            id: openCode ? `opencode:${baseline}` : `${descriptor.id}:${id}`,
          });
          try {
            contextReading = undefined;
            const blocks: ContentBlock[] = [
              {
                type: "text",
                text:
                  openCode || nativeInstructions
                    ? text
                    : `${instructions}\n\n${text}`,
              },
              ...images,
            ];
            const [outcome] = await Promise.all([
              prompts
                ? prompts.run(blocks)
                : rpc.prompt({ sessionId: id, prompt: blocks }),
              descriptor.toolDiscovery === "prompt"
                ? process.toolsReady?.()
                : undefined,
            ]);
            await events;
            if (!openCode && (outcome.usage || nativeCost !== undefined))
              await emit({
                type: "usage",
                usage: {
                  id: turnId,
                  source: `${descriptor.id}.acp.prompt`,
                  provider: null,
                  model: config.model,
                  input: outcome.usage?.inputTokens ?? null,
                  output: outcome.usage?.outputTokens ?? null,
                  cacheRead: outcome.usage?.cachedReadTokens ?? null,
                  cacheWrite: outcome.usage?.cachedWriteTokens ?? null,
                  costUsd: cost.read(turnId, nativeCost),
                  costBasis: "reported",
                  costCumulative: nativeCost,
                  costCounter,
                },
              });
            if (outcome.stopReason === "cancelled")
              throw new Error("工作已停止。");
            await publishReply();
            const updated =
              since(
                await messages().catch(async () => {
                  await emit({
                    type: "runtime",
                    state: {
                      notices: {
                        history:
                          "回复已完成，用量记录暂不可读。原生会话已保留。",
                      },
                    },
                  });
                  return [];
                }),
                baseline,
              ) ?? [];
            const compacted = completedCompaction(updated);
            if (compacted && !compactionConfirmed) {
              compactionConfirmed = true;
              await emit({
                type: "compaction",
                status: "completed",
                nativeId: compacted.info.id,
              });
              if (contextReading) await emit(contextReading);
            }
            for (const message of updated)
              if (message.info.role === "assistant") await record(message);
          } finally {
            active = false;
          }
        },
        async interrupt() {
          for (const item of pending.values()) item.answer({ allow: false });
          await rpc.cancel({ sessionId: id });
        },
        async recover(cursor) {
          if (!cursor?.startsWith("opencode:")) return false;
          const history = await messages();
          const baseline = cursor.slice(9);
          const turn = since(history, baseline);
          if (!turn) return false;
          const users = turn.filter((message) => message.info.role === "user");
          const final = turn.at(-1)?.info;
          if (
            users.length !== 1 ||
            final?.role !== "assistant" ||
            !final.time?.completed ||
            !final.finish ||
            ["tool-calls", "unknown"].includes(final.finish) ||
            final.error ||
            final.parentID !== users[0]?.info.id
          )
            return false;
          for (const message of turn)
            if (message.info.role === "assistant") {
              await recordMessage(message, true);
            }
          return true;
        },
        async answer(requestId, answer) {
          const item = pending.get(requestId);
          if (!item) throw new Error("这次确认已经失效。");
          if (answer.allow) item.validate?.(answer);
          item.answer(answer);
        },
      };
      return session;
    },
  };
  return provider;
}
