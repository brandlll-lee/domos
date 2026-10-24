import { EngineRequestRejected } from "../json-lines.ts";
import type {
  EngineAnswer,
  EngineApproval,
  EngineOpen,
  EngineProvider,
  EngineSession,
} from "../types.ts";
import { codexAnswer, codexApproval } from "./codex-approval.ts";
import { openCodexClient } from "./codex-client.ts";
import { readCodexTurn } from "./codex-history.ts";
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
  async inspect({ process, config, env }) {
    const client = await openCodexClient(process, config, env);
    return {
      authenticated: await client.authenticated(),
      models: await client.models(),
      controls: await client.controls(),
      vision: await client.vision(),
    };
  },
  async open({
    process,
    config,
    sessionId,
    instructions,
    emit,
    env,
  }: EngineOpen) {
    const ready = await process.ready;
    const client = await openCodexClient(process, config, env);
    const { rpc, modes, vision } = client;
    let completion: ReturnType<typeof Promise.withResolvers<void>> | undefined;
    let turnId: string | null = null;
    let nativeId: string | undefined = sessionId ?? undefined;
    let events = Promise.resolve();
    let provider: string | null = null;
    let model = config.model;
    let compacting = false;
    let compactBoundary = false;
    let metering = false;
    let starting: Promise<void> | undefined;
    let baseline: NonNullable<
      NonNullable<CodexFrame["params"]>["tokenUsage"]
    >["total"];
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
            let approval: EngineApproval;
            try {
              approval = codexApproval(frame);
            } catch (error) {
              if (frame.method !== "mcpServer/elicitation/request") throw error;
              await rpc.send({
                id: frame.id,
                result: { action: "cancel", content: null, _meta: null },
              });
              await emit({
                type: "runtime",
                state: {
                  notices: {
                    [`codex:${frame.id}`]:
                      error instanceof Error
                        ? error.message
                        : "Codex 确认请求无效。",
                  },
                },
              });
              return;
            }
            requests.set(String(frame.id), frame);
            await emit({ type: "approval", approval });
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
          if (frame.method === "turn/started") {
            await emit({ type: "runtime", state: { processing: true } });
            turnId = params.turn?.id ?? null;
            if (compacting && turnId)
              await emit({ type: "accepted", id: turnId, ready: false });
          }
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
              type: "context",
              tokens: usage.last?.inputTokens ?? null,
              window: usage.modelContextWindow ?? null,
              source: "codex.thread/tokenUsage/updated",
              basis: "last-input",
              estimated: false,
              model,
            });
          }
          if (
            item?.type === "contextCompaction" &&
            (frame.method === "item/started" ||
              frame.method === "item/completed")
          ) {
            if (frame.method === "item/completed") compactBoundary = true;
            await emit({
              type: "compaction",
              status: frame.method === "item/started" ? "running" : "completed",
              nativeId: item.id,
            });
          }
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
                  [
                    item.aggregatedOutput ??
                      (item.result ? JSON.stringify(item.result) : undefined),
                    item.error ? JSON.stringify(item.error) : undefined,
                  ]
                    .filter(Boolean)
                    .join("\n") || JSON.stringify(item.changes ?? ""),
                failed:
                  item.status === "failed" ||
                  Boolean(item.error) ||
                  (item.result as { isError?: boolean } | null)?.isError ===
                    true,
              });
          }
          if (frame.method === "turn/completed") {
            if (compacting && params.turn?.status !== "completed")
              await emit({
                type: "compaction",
                status: "failed",
                error: "Codex 未完成压缩。",
              });
            if (
              params.turn?.status === "completed" &&
              (!compacting || compactBoundary)
            )
              completion?.resolve();
            else
              completion?.reject(
                new Error("Codex 未完成任务。请检查账号和工作电脑。"),
              );
          }
        })
        .catch((error) => completion?.reject(error));
    });
    rpc.on("closed", (error) => completion?.reject(error));
    const response = await rpc.request<{
      thread: { id: string };
      modelProvider?: string;
      model?: string;
    }>(sessionId ? "thread/resume" : "thread/start", {
      ...(sessionId ? { threadId: sessionId, excludeTurns: true } : {}),
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
    await emit({
      type: "runtime",
      state: {
        contextPolicy: { manual: true, automatic: "native", refresh: false },
      },
    });
    const session: EngineSession = {
      id,
      controls: client.controls,
      async compact() {
        compacting = true;
        compactBoundary = false;
        metering = true;
        completion = Promise.withResolvers<void>();
        void completion.promise.catch(() => {});
        try {
          await rpc.request("thread/compact/start", { threadId: id });
          await completion.promise;
          await events;
        } finally {
          compacting = false;
        }
      },
      async recoverCompaction(cursor) {
        if (!cursor) return false;
        const turn = await readCodexTurn(rpc, id, cursor);
        return (
          turn?.items?.some((item) => item.type === "contextCompaction") ??
          false
        );
      },
      models: client.models,
      vision,
      authenticated: client.authenticated,
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
        for (const [requestId, request] of requests) {
          if (request.method === "mcpServer/elicitation/request") {
            requests.delete(requestId);
            await rpc.send({
              id: request.id,
              result: { action: "cancel", content: null, _meta: null },
            });
          } else await session.answer(requestId, { allow: false });
        }
        if (turnId)
          await rpc.request("turn/interrupt", { threadId: id, turnId });
      },
      async answer(requestId: string, answer: EngineAnswer) {
        const request = requests.get(requestId);
        if (!request) throw new Error("这次确认已经失效。");
        const result = codexAnswer(request, answer);
        requests.delete(requestId);
        await rpc.send({ id: request.id, result });
      },
      async recover(nativeTurn) {
        if (!nativeTurn) return false;
        const turn = await readCodexTurn(rpc, id, nativeTurn);
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
