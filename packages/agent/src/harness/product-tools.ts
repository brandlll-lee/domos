import { createHash } from "node:crypto";
import type { Context } from "@earendil-works/chord/context";
import {
  defineDoc,
  type JsonObject,
  NestedCallDoc,
  type TaskId,
  ToolTask,
} from "@earendil-works/pi-durable";
import type { MessageDelivery } from "../delivery.ts";
import { EngineDoc, EngineMessage } from "./state.ts";
import { type EngineRuntime, stored } from "./task-types.ts";
import type { ProductResult, ProductTool } from "./types.ts";

const productExtensions = new Set([
  "domos-messaging",
  "domos-memory",
  "domos-skills",
  "domos-routines",
]);
const ProductCalls = defineDoc<{ delivered: string[] }>({
  kind: "domos.engine-product-calls",
  version: 1,
  scope: "task",
  initial: () => ({ delivered: [] }),
});
export const permissionTool: ProductTool = {
  name: "approve",
  description: "Ask the user to approve a native tool operation.",
  inputSchema: {
    type: "object",
    properties: {
      tool_name: { type: "string" },
      input: { type: "object" },
      tool_use_id: { type: "string" },
    },
    required: ["tool_name", "input"],
  },
};

export async function productCatalog(
  runtime: EngineRuntime,
  context: Context,
): Promise<ProductTool[]> {
  const agent = await runtime.agent(context);
  const names = new Set(agent.callable.map((tool) => tool.name));
  return runtime.registry
    .tools()
    .filter(
      ({ extension, tool }) =>
        names.has(tool.name) &&
        (productExtensions.has(extension.name) || tool.name === "attach_file"),
    )
    .map(({ tool }) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: stored(tool.parameters) as Record<string, unknown>,
    }));
}

export async function callProductTool(
  runtime: EngineRuntime,
  callId: string,
  name: string,
  args: Record<string, unknown>,
  context: Context,
): Promise<ProductResult> {
  const catalog = await productCatalog(runtime, context);
  if (!catalog.some((tool) => tool.name === name))
    throw new Error("产品工具不可用。");
  const key = createHash("sha256").update(callId).digest("hex");
  let id: TaskId | undefined;
  await runtime.commit(async (tx) => {
    const doc = await tx.doc(NestedCallDoc, runtime.taskId, key, null);
    if (doc.taskId) {
      const previous = await tx.task(doc.taskId);
      const input = previous?.input as {
        call?: { name: string; arguments: JsonObject };
      };
      if (
        input?.call?.name !== name ||
        JSON.stringify(input.call.arguments) !== JSON.stringify(args)
      )
        throw new Error("工具请求标识重复。");
      id = doc.taskId;
      return;
    }
    doc.taskId = await tx.createTask(
      ToolTask,
      {
        kind: "nested",
        parent: runtime.taskId,
        parentCallId: String(runtime.taskId),
        key,
        call: {
          type: "toolCall",
          id: callId,
          name,
          arguments: stored(args) as JsonObject,
        },
        progress: false,
      },
      {
        ownership: { kind: "task", taskId: runtime.taskId },
        conversationId: runtime.conversationId,
      },
    );
    id = doc.taskId;
  }, context);
  if (!id) throw new Error("产品工具未能排队。");
  await runtime.waitForTask(id, context);
  const result = (
    await runtime.snapshot(NestedCallDoc, runtime.taskId, key, context)
  )?.result;
  if (!result) throw new Error("产品工具结果未确认。");
  const details = result.details as
    | { attachment?: unknown; delivery?: MessageDelivery }
    | undefined;
  if (details?.attachment || details?.delivery) {
    await runtime.commit(async (tx) => {
      const doc = await tx.doc(ProductCalls, runtime.taskId);
      if (doc.delivered.includes(key)) return;
      doc.delivered.push(key);
      await tx.appendEntry(runtime.conversationId, {
        kind: EngineMessage,
        data: stored({
          id: `product:${id}`,
          turnId: (await tx.doc(EngineDoc, runtime.conversationId)).activeTurn,
          role: "toolResult",
          content: [],
          stopped: false,
          timestamp: Date.now(),
          toolCallId: callId,
          toolName: name,
          toolStatus: "done",
          isError: false,
          ...(details.attachment ? { attachments: [details.attachment] } : {}),
          ...(details.delivery ? { delivery: details.delivery } : {}),
        }),
      });
    }, context);
  }
  const text =
    typeof result.structuredOutput === "string"
      ? result.structuredOutput
      : result.structuredOutput !== undefined
        ? JSON.stringify(result.structuredOutput)
        : result.diagnostics.map((item) => item.message).join("\n");
  return {
    content: [{ type: "text", text }],
    ...(result.isError ? { isError: true } : {}),
  };
}
