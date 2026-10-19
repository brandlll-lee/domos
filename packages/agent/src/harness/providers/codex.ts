import { JsonLines } from "../json-lines.ts";
import type { EngineAnswer, EngineOpen, EngineProvider } from "../types.ts";
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
    let events = Promise.resolve();
    const requests = new Map<string, CodexFrame>();
    rpc.on("frame", (frame: CodexFrame) => {
      events = events
        .then(async () => {
          const params = frame.params ?? {};
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
    });
    await rpc.send({ method: "initialized", params: {} });
    if (env?.OPENAI_API_KEY)
      await rpc.request("account/login/start", {
        type: "apiKey",
        apiKey: env.OPENAI_API_KEY,
      });
    const response = await rpc.request<{ thread: { id: string } }>(
      sessionId ? "thread/resume" : "thread/start",
      {
        ...(sessionId ? { threadId: sessionId } : {}),
        cwd: ready.cwd,
        ...(config.model ? { model: config.model } : {}),
        developerInstructions: instructions,
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
      },
    );
    const id = response.thread?.id;
    if (typeof id !== "string") throw new Error("Codex 没有返回会话记录。");
    await emit({ type: "session", id });
    async function catalog() {
      type Model = {
        id: string;
        model?: string;
        displayName?: string;
        inputModalities?: string[];
        isDefault?: boolean;
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
    return {
      id,
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
        void completion.promise.catch(() => {});
        const result = await rpc.request<{ turn: CodexTurn }>("turn/start", {
          threadId: id,
          input: [
            { type: "text", text },
            ...images.map((image) => ({
              type: "image",
              url: `data:${image.mimeType};base64,${image.data}`,
            })),
          ],
        });
        turnId = result.turn?.id ?? null;
        await emit({ type: "accepted", ...(turnId ? { id: turnId } : {}) });
        await completion.promise;
        await events;
      },
      async interrupt() {
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
                { answers: [answer.text ?? ""] },
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
  },
};
