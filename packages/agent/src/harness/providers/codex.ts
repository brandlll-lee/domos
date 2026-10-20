import { EngineRequestRejected, JsonLines } from "../json-lines.ts";
import type {
  EngineAnswer,
  EngineOpen,
  EngineProvider,
  EngineSession,
} from "../types.ts";
import {
  type CodexFrame,
  type CodexTurn,
  codexApprovals,
} from "./codex-wire.ts";

export const codexProvider: EngineProvider = {
  id: "codex",
  name: "Codex",
  command: "codex",
  package: "@openai/codex@0.159.2",
  login: ["login", "--device-auth"],
  capabilities: { approvals: true, models: true, recovery: true },
  async open({
    process,
    config,
    sessionId,
    instructions,
    emit,
    env,
  }: EngineOpen) {
    const ready = await process.ready;
    const rpc = new JsonLines(process);
    let completion: ReturnType<typeof Promise.withResolvers<void>> | undefined;
    let turnId: string | null = null;
    let nativeId: string | undefined = sessionId ?? undefined;
    let events = Promise.resolve();
    let provider: string | null = null;
    let model = config.model;
    let compacting = false;
    let metering = false;
    let starting: Promise<void> | undefined;
    let baseline: NonNullable<
      NonNullable<CodexFrame["params"]>["tokenUsage"]
    >["total"];
    let modeCatalog:
      | {
          name: string;
          mode: string;
          model: string;
          reasoning_effort?: string | null;
        }[]
      | undefined;
    async function modes() {
      if (!modeCatalog) {
        try {
          modeCatalog =
            (
              await rpc.request<{ data: NonNullable<typeof modeCatalog> }>(
                "collaborationMode/list",
              )
            ).data ?? [];
        } catch (error) {
          if (!(error instanceof EngineRequestRejected)) throw error;
          modeCatalog = [];
        }
      }
      return modeCatalog;
    }
    const requests = new Map<string, CodexFrame>();
    rpc.on("frame", (frame: CodexFrame) => {
      events = events
        .then(async () => {
          const params = frame.params ?? {};
          if (params.threadId && params.threadId !== nativeId) return;
          if (
            frame.method === "serverRequest/resolved" &&
            params.requestId !== undefined
          ) {
            const id = String(params.requestId);
            requests.delete(id);
            await emit({ type: "approval_closed", id });
          }
          if (frame.id !== undefined) {
            if (!codexApprovals.has(frame.method)) {
              await rpc.send({
                id: frame.id,
                error: { code: -32601, message: "Unsupported request" },
              });
              return;
            }
            requests.set(String(frame.id), frame);
            await emit({
              type: "approval",
              approval: {
                id: String(frame.id),
                title:
                  frame.method === "item/tool/requestUserInput"
                    ? "需要你的回答"
                    : "允许这次操作？",
                detail: [
                  params.command,
                  params.cwd,
                  params.reason,
                  ...(params.questions?.map((question) => question.question) ??
                    []),
                  params.permissions ? JSON.stringify(params.permissions) : "",
                ]
                  .filter(Boolean)
                  .join("\n")
                  .slice(0, 8000),
                kind:
                  frame.method === "item/tool/requestUserInput"
                    ? "question"
                    : "permission",
                ...(params.questions
                  ? {
                      questions: params.questions.map((question) => ({
                        id: question.id,
                        title: question.question,
                        ...(question.isOther ? { allowOther: true } : {}),
                        ...(question.options
                          ? {
                              options: question.options.map((option) => ({
                                id: option.label,
                                label: option.label,
                                ...(option.description
                                  ? { description: option.description }
                                  : {}),
                              })),
                            }
                          : {}),
                      })),
                    }
                  : {}),
              },
            });
            return;
          }
          if (
            frame.method === "item/agentMessage/delta" &&
            params.itemId &&
            params.delta
          )
            await emit({ type: "text", id: params.itemId, text: params.delta });
          if (
            (frame.method === "item/reasoning/textDelta" ||
              frame.method === "item/reasoning/summaryTextDelta") &&
            params.itemId &&
            params.delta
          )
            await emit({
              type: "thinking",
              id: params.itemId,
              text: params.delta,
            });
          const item = params.item;
          if (frame.method === "turn/started") turnId = params.turn?.id ?? null;
          if (
            frame.method === "thread/tokenUsage/updated" &&
            params.tokenUsage
          ) {
            const usage = params.tokenUsage;
            await starting;
            if (!metering || (params.turnId && params.turnId !== turnId)) {
              baseline = usage.total;
              return;
            }
            if (usage.total)
              await emit({
                type: "usage",
                usage: {
                  id: "codex:usage",
                  source: "codex.thread/tokenUsage/updated",
                  provider,
                  model,
                  input:
                    usage.total.inputTokens === undefined
                      ? null
                      : usage.total.inputTokens - (baseline?.inputTokens ?? 0),
                  output:
                    usage.total.outputTokens === undefined
                      ? null
                      : usage.total.outputTokens -
                        (baseline?.outputTokens ?? 0),
                  cacheRead:
                    usage.total.cachedInputTokens === undefined
                      ? null
                      : usage.total.cachedInputTokens -
                        (baseline?.cachedInputTokens ?? 0),
                  cacheWrite: null,
                  costUsd: null,
                },
              });
            await emit({
              type: "runtime",
              state: {
                contextTokens: usage.last?.inputTokens ?? null,
                contextWindow: usage.modelContextWindow ?? null,
              },
            });
          }
          if (item?.type === "contextCompaction")
            await emit({
              type: "runtime",
              state: {
                compaction:
                  frame.method === "item/started" ? "running" : "completed",
              },
            });
          if (
            frame.method === "item/started" &&
            item &&
            ["commandExecution", "fileChange", "mcpToolCall"].includes(
              item.type,
            )
          )
            await emit({
              type: "tool",
              id: item.id,
              name: item.tool ?? item.type,
              input: item.arguments ?? {
                command: item.command,
                changes: item.changes,
              },
            });
          if (frame.method === "item/completed" && item) {
            if (item.type === "agentMessage")
              await emit({
                type: "message",
                id: item.id,
                text: item.text ?? "",
              });
            else if (
              ["commandExecution", "fileChange", "mcpToolCall"].includes(
                item.type,
              )
            )
              await emit({
                type: "tool_result",
                id: item.id,
                name: item.tool ?? item.type,
                text:
                  item.aggregatedOutput ??
                  JSON.stringify(item.result ?? item.changes ?? ""),
                failed: item.status === "failed" || Boolean(item.error),
              });
          }
          if (frame.method === "turn/completed") {
            if (compacting)
              await emit({
                type: "runtime",
                state: {
                  compaction:
                    params.turn?.status === "completed"
                      ? "completed"
                      : "failed",
                },
              });
            if (params.turn?.status === "completed") completion?.resolve();
            else
              completion?.reject(
                new Error("Codex 未完成任务。请检查账号和工作电脑。"),
              );
          }
        })
        .catch((error) => completion?.reject(error));
    });
    rpc.on("closed", (error) => completion?.reject(error));
    await process.launch({
      command: "codex",
      args: [
        "app-server",
        "--listen",
        "stdio://",
        "-c",
        `mcp_servers.domos.url=${JSON.stringify(ready.url)}`,
      ],
      env: { ...env, CODEX_HOME: `${ready.home}/codex` },
    });
    await rpc.request("initialize", {
      clientInfo: { name: "domos", version: "1.0.0" },
      capabilities: { experimentalApi: true },
    });
    await rpc.send({ method: "initialized", params: {} });
    if (env?.OPENAI_API_KEY)
      await rpc.request("account/login/start", {
        type: "apiKey",
        apiKey: env.OPENAI_API_KEY,
      });
    const response = await rpc.request<{
      thread: { id: string };
      modelProvider?: string;
      model?: string;
    }>(sessionId ? "thread/resume" : "thread/start", {
      ...(sessionId ? { threadId: sessionId } : {}),
      cwd: ready.cwd,
      ...(config.model ? { model: config.model } : {}),
      developerInstructions: instructions,
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
    });
    const id = response.thread?.id;
    nativeId = id;
    provider = response.modelProvider ?? null;
    model = response.model ?? config.model;
    if (typeof id !== "string") throw new Error("Codex 没有返回会话记录。");
    await emit({ type: "session", id });
    async function catalog() {
      type Model = {
        id: string;
        model?: string;
        displayName?: string;
        inputModalities?: string[];
        isDefault?: boolean;
        supportedReasoningEfforts?: {
          reasoningEffort: string;
          description: string;
        }[];
      };
      const models: Model[] = [];
      let cursor: string | null = null;
      do {
        const page: { data?: Model[]; nextCursor?: string | null } =
          await rpc.request("model/list", {
            limit: 100,
            ...(cursor ? { cursor } : {}),
          });
        models.push(...(page.data ?? []));
        cursor = page.nextCursor ?? null;
      } while (cursor);
      return models;
    }
    async function vision() {
      const model = (await catalog()).find((item) =>
        config.model
          ? item.id === config.model || item.model === config.model
          : item.isDefault,
      );
      return model?.inputModalities
        ? model.inputModalities.includes("image")
        : null;
    }
    const session: EngineSession = {
      id,
      async controls() {
        const selected = (await catalog()).find((item) =>
          config.model
            ? item.id === config.model || item.model === config.model
            : item.isDefault,
        );
        return {
          compact: true,
          commands: [],
          options: [
            {
              id: "effort",
              label: "推理强度",
              value: config.options?.effort ?? "",
              options: (selected?.supportedReasoningEfforts ?? []).map(
                (item) => ({
                  id: item.reasoningEffort,
                  label: item.description,
                }),
              ),
            },
            {
              id: "approvalPolicy",
              label: "工作模式",
              value: config.options?.approvalPolicy ?? "on-request",
              options: [
                { id: "on-request", label: "按需确认" },
                { id: "untrusted", label: "受限操作确认" },
              ],
            },
            {
              id: "mode",
              label: "协作模式",
              value: config.options?.mode ?? "",
              options: (await modes()).map((item) => ({
                id: item.mode,
                label: item.name,
              })),
            },
          ],
        };
      },
      async compact() {
        compacting = true;
        metering = true;
        completion = Promise.withResolvers<void>();
        void completion.promise.catch(() => {});
        await emit({ type: "runtime", state: { compaction: "running" } });
        try {
          await rpc.request("thread/compact/start", { threadId: id });
          await completion.promise;
          await events;
        } catch (error) {
          await emit({ type: "runtime", state: { compaction: "failed" } });
          throw error;
        } finally {
          compacting = false;
        }
      },
      models: async () =>
        (await catalog()).map((model) => ({
          id: model.id,
          name: model.displayName ?? model.id,
          ...(model.inputModalities
            ? { images: model.inputModalities.includes("image") }
            : {}),
        })),
      vision,
      authenticated: async () => {
        const account = await rpc.request<{
          account?: unknown;
          requiresOpenaiAuth?: boolean;
        }>("account/read", {
          refreshToken: false,
        });
        return Boolean(account.account) || account.requiresOpenaiAuth === false;
      },
      async prompt(text, images = []) {
        if (images.length && (await vision()) === false)
          throw new Error("当前模型不支持图片。请选择支持图片的模型。");
        completion = Promise.withResolvers<void>();
        metering = true;
        void completion.promise.catch(() => {});
        const mode = config.options?.mode
          ? (await modes()).find((item) => item.mode === config.options?.mode)
          : undefined;
        if (config.options?.mode && !mode)
          throw new Error("此引擎没有提供这个协作模式。");
        const started = Promise.withResolvers<void>();
        starting = started.promise;
        try {
          const result = await rpc.request<{ turn: CodexTurn }>("turn/start", {
            threadId: id,
            ...(config.options?.effort
              ? { effort: config.options.effort }
              : {}),
            ...(config.options?.approvalPolicy
              ? { approvalPolicy: config.options.approvalPolicy }
              : {}),
            ...(mode
              ? {
                  collaborationMode: {
                    mode: mode.mode,
                    settings: {
                      model: config.model ?? mode.model,
                      reasoning_effort:
                        config.options?.effort ?? mode.reasoning_effort ?? null,
                      developer_instructions: null,
                    },
                  },
                }
              : {}),
            input: [
              { type: "text", text },
              ...images.map((image) => ({
                type: "image",
                url: `data:${image.mimeType};base64,${image.data}`,
              })),
            ],
          });
          turnId = result.turn?.id ?? null;
        } finally {
          started.resolve();
          starting = undefined;
        }
        await emit({ type: "accepted", ...(turnId ? { id: turnId } : {}) });
        await completion.promise;
        await events;
      },
      async steer(text, images = []) {
        if (!turnId) return "refused";
        if (images.length && (await vision()) === false) return "refused";
        try {
          await rpc.request("turn/steer", {
            threadId: id,
            expectedTurnId: turnId,
            input: [
              { type: "text", text },
              ...images.map((image) => ({
                type: "image",
                url: `data:${image.mimeType};base64,${image.data}`,
              })),
            ],
          });
          return "accepted";
        } catch (error) {
          return error instanceof EngineRequestRejected
            ? "refused"
            : "uncertain";
        }
      },
      async interrupt() {
        for (const requestId of requests.keys())
          await session.answer(requestId, { allow: false });
        if (turnId)
          await rpc.request("turn/interrupt", { threadId: id, turnId });
      },
      async answer(requestId: string, answer: EngineAnswer) {
        const request = requests.get(requestId);
        if (!request) throw new Error("这次确认已经失效。");
        requests.delete(requestId);
        let result: object = { decision: answer.allow ? "accept" : "decline" };
        if (request.method === "item/tool/requestUserInput")
          result = {
            answers: Object.fromEntries(
              (request.params?.questions ?? []).map((question) => [
                question.id,
                {
                  answers: answer.allow
                    ? (answer.answers?.[question.id] ?? [answer.text ?? ""])
                    : [],
                },
              ]),
            ),
          };
        else if (request.method === "item/permissions/requestApproval")
          result = {
            permissions: answer.allow
              ? (request.params?.permissions ?? {})
              : {},
            scope: "turn",
          };
        await rpc.send({ id: request.id, result });
      },
      async recover(nativeTurn) {
        const result = await rpc.request<{ thread: { turns?: CodexTurn[] } }>(
          "thread/read",
          {
            threadId: id,
            includeTurns: true,
          },
        );
        const turn = result.thread?.turns?.find(
          (item) => item.id === nativeTurn,
        );
        if (turn?.status !== "completed") return false;
        for (const item of turn.items ?? [])
          if (item.type === "agentMessage")
            await emit({
              type: "message",
              id: item.id,
              text: item.text ?? "",
            });
        return true;
      },
    };
    return session;
  },
};
