import type { ToolCall, ToolCallUpdate } from "@agentclientprotocol/sdk";
import type { EngineOpen } from "../types.ts";

export function acpTools(emit: EngineOpen["emit"]) {
  const toolCalls = new Map<string, Partial<ToolCall>>();
  return async (
    update: ToolCallUpdate | ToolCall,
    recovered = false,
    timing: {
      timestamp?: number;
      endedAt?: number;
      receivedAt?: number;
      parentId?: string;
    } = {},
  ) => {
    const previous = toolCalls.get(update.toolCallId);
    const native = {
      ...previous,
      ...Object.fromEntries(
        Object.entries(update).filter(([, value]) => value != null),
      ),
    } as Partial<ToolCall>;
    toolCalls.set(update.toolCallId, native);
    const metadata = {
      ...(recovered ? { recovered: true } : {}),
      ...timing,
    };
    const { rawOutput: _output, content: _content, ...input } = native;
    if (
      !previous ||
      update.rawInput != null ||
      update.title != null ||
      recovered
    )
      await emit({
        type: "tool",
        id: update.toolCallId,
        name: native.title ?? "Tool",
        input: (native.rawInput ?? {}) as Record<string, unknown>,
        native: input,
        ...metadata,
      });
    if (native.status || native.rawOutput != null || native.content?.length)
      await emit({
        type: "tool_result",
        id: update.toolCallId,
        name: native.title ?? "Tool",
        text: "",
        failed: native.status === "failed",
        partial: !["completed", "failed"].includes(native.status ?? ""),
        native: native as Record<string, unknown>,
        ...metadata,
      });
  };
}
