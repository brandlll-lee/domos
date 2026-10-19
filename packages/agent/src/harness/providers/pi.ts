import type {
  AgentSessionEvent,
  RpcSessionState,
} from "@earendil-works/pi-coding-agent";
import { JsonLines } from "../json-lines.ts";
import type { EngineOpen, EngineProvider } from "../types.ts";

export const piProvider: EngineProvider = {
  id: "pi",
  name: "Pi",
  command: "pi",
  package: "@earendil-works/pi-coding-agent@1.2.0",
  login: null,
  capabilities: { approvals: false, models: true, recovery: false },
  async open({
    process,
    config,
    sessionId,
    instructions,
    emit,
    env,
  }: EngineOpen) {
    const ready = await process.ready;
    const rpc = new JsonLines(process, true);
    const preparation = Promise.withResolvers<void>();
    void preparation.promise.catch(() => {});
    let messageId = "";
    let sequence = 0;
    let failure: string | null = null;
    let completion: ReturnType<typeof Promise.withResolvers<void>> | undefined;
    let events = Promise.resolve();
    rpc.on(
      "frame",
      (frame: AgentSessionEvent | { type: "domos_ready"; error?: string }) => {
        if (frame.type === "domos_ready") {
          if (frame.error) preparation.reject(new Error(frame.error));
          else preparation.resolve();
          return;
        }
        events = events
          .then(async () => {
            if (
              frame.type === "message_start" &&
              frame.message?.role === "assistant"
            )
              messageId = `pi:${++sequence}`;
            if (frame.type === "message_update") {
              const part = frame.assistantMessageEvent;
              if (
                part?.type === "text_delta" ||
                part?.type === "thinking_delta"
              )
                await emit({
                  type: part.type === "text_delta" ? "text" : "thinking",
                  id: messageId,
                  text: part.delta,
                });
            }
            if (
              frame.type === "message_end" &&
              frame.message?.role === "assistant"
            ) {
              const message = frame.message;
              if (message.stopReason === "error")
                failure =
                  message.errorMessage ?? "Pi 未完成回复。请检查账号和网络。";
              if (message.stopReason === "aborted") failure = "工作已停止。";
              if (
                message.stopReason !== "error" &&
                message.stopReason !== "aborted"
              )
                await emit({
                  type: "message",
                  id: messageId,
                  text: textContent(message.content),
                });
            }
            if (frame.type === "tool_execution_start")
              await emit({
                type: "tool",
                id: frame.toolCallId,
                name: frame.toolName,
                input: frame.args ?? {},
              });
            if (frame.type === "tool_execution_end")
              await emit({
                type: "tool_result",
                id: frame.toolCallId,
                name: frame.toolName,
                text: textContent(frame.result?.content),
                failed: Boolean(frame.isError),
              });
            if (frame.type === "agent_settled") {
              if (failure) completion?.reject(new Error(failure));
              else completion?.resolve();
            }
          })
          .catch((error) => completion?.reject(error));
      },
    );
    rpc.on("closed", (error) => {
      preparation.reject(error);
      completion?.reject(error);
    });
    await process.launch({
      command: "pi",
      args: [
        "--session-dir",
        `${ready.home}/pi/sessions`,
        "--append-system-prompt",
        "__DOMOS_PROMPT__",
      ],
      instructions,
      env: {
        ...env,
        PI_CODING_AGENT_DIR: `${ready.home}/pi`,
        DOMOS_PI_MCP_URL: ready.url,
      },
    });
    await preparation.promise;
    if (sessionId)
      await rpc.request("switch_session", { sessionPath: sessionId });
    else await rpc.request("new_session");
    if (config.model) {
      const separator = config.model.indexOf("/");
      if (separator < 1) throw new Error("请选择 Pi 的模型。");
      await rpc.request("set_model", {
        provider: config.model.slice(0, separator),
        modelId: config.model.slice(separator + 1),
      });
    }
    const state = await rpc.request<RpcSessionState>("get_state");
    if (!state.sessionFile) throw new Error("Pi 没有返回会话记录。");
    await emit({ type: "session", id: state.sessionFile });
    return {
      id: state.sessionFile,
      models: async () => {
        const result = await rpc.request<{
          models: {
            provider: string;
            id: string;
            name?: string;
            input?: string[];
          }[];
        }>("get_available_models");
        return (result.models ?? []).map((model) => ({
          id: `${model.provider}/${model.id}`,
          name: model.name ?? model.id,
          ...(model.input ? { images: model.input.includes("image") } : {}),
        }));
      },
      authenticated: async () =>
        Boolean(
          (await rpc.request<{ models: unknown[] }>("get_available_models"))
            .models?.length,
        ),
      vision: async () =>
        state.model?.input ? state.model.input.includes("image") : null,
      async prompt(text, images = []) {
        if (
          images.length &&
          state.model?.input &&
          !state.model.input.includes("image")
        )
          throw new Error("当前模型不支持图片。请选择支持图片的模型。");
        completion = Promise.withResolvers<void>();
        failure = null;
        void completion.promise.catch(() => {});
        const result = await rpc.request("prompt", {
          message: text,
          ...(images.length ? { images } : {}),
        });
        await emit({ type: "accepted" });
        if (result.disposition === "handled") completion.resolve();
        await completion.promise;
        await events;
      },
      async interrupt() {
        await rpc.request("clear_queue");
        await rpc.request("abort");
      },
      answer: async () => {
        throw new Error("Pi 使用工作电脑的授权。");
      },
    };
  },
};

export function textContent(content: unknown): string {
  return typeof content === "string"
    ? content
    : (Array.isArray(content) ? content : [])
        .filter(
          (part) => part?.type === "text" && typeof part.text === "string",
        )
        .map((part: { text: string }) => part.text)
        .join("\n");
}
