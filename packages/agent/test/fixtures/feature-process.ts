import { ProtocolProcess } from "./engine-process.ts";

export function featureProcess() {
  const process = new ProtocolProcess();
  let thinkingLevel = "medium";
  let compacted = false;
  const finish = (text: string) => {
    const message = {
      role: "assistant",
      timestamp: Date.now(),
      provider: "test-provider",
      model: "test-model",
      stopReason: "stop",
      content: [{ type: "text", text }],
      usage: { input: 12, output: 4, cacheRead: 3, cacheWrite: 0 },
    };
    process.frame({ type: "message_start", message });
    process.frame({ type: "message_end", message });
    process.frame({ type: "agent_settled" });
  };
  process.receive = (request) => {
    if (request.type === "compact") compacted = true;
    const value = request as unknown as {
      type: string;
      level?: string;
      value?: string;
      cancelled?: boolean;
    };
    if (value.type === "extension_ui_response") {
      finish(value.cancelled ? "Cancelled" : `Complete ${value.value}`);
      return;
    }
    if (value.type === "set_thinking_level")
      thinkingLevel = value.level ?? thinkingLevel;
    const data =
      request.type === "get_state"
        ? {
            sessionFile: "/native/session",
            thinkingLevel,
            autoCompactionEnabled: true,
            model: {
              provider: "test-provider",
              id: "test-model",
              input: ["text"],
            },
          }
        : request.type === "get_available_thinking_levels"
          ? { levels: ["low", "medium", "high"] }
          : request.type === "get_available_models"
            ? {
                models: [
                  {
                    provider: "test-provider",
                    id: "test-model",
                    name: "Test model",
                    input: ["text"],
                  },
                ],
              }
            : request.type === "get_commands"
              ? {
                  commands: [
                    {
                      name: "review",
                      description: "Review work",
                      source: "extension",
                    },
                  ],
                }
              : request.type === "get_session_stats"
                ? {
                    contextUsage: {
                      tokens: compacted ? null : 120,
                      contextWindow: 1000,
                    },
                  }
                : {};
    process.frame({ type: "response", id: request.id, success: true, data });
    if (request.type === "prompt")
      process.frame({
        type: "extension_ui_request",
        id: "target",
        method: "select",
        title: "Choose target",
        options: ["Preview", "Production"],
      });
    if (request.type === "compact") {
      process.frame({ type: "compaction_start", reason: "manual" });
      process.frame({
        type: "compaction_end",
        reason: "manual",
        aborted: false,
        result: {},
      });
    }
  };
  return process;
}
