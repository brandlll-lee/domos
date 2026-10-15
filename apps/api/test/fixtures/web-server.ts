import { createServer } from "node:http";
import { openAgent } from "@domos/agent";
import { Files } from "@domos/agent/files";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  type FauxResponseFactory,
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai/providers/faux";
import {
  createRegistry,
  defineExtension,
  defineTool,
} from "@earendil-works/pi-durable";
import { getRequestListener } from "@hono/node-server";
import { createApp } from "../../src/app.ts";

const database = process.argv[2];
if (!database) throw new Error("Database required");
const faux = fauxProvider({
  models: [
    { id: "faux-1", name: "测试模型一" },
    { id: "faux-2", name: "测试模型二" },
  ],
  tokensPerSecond: 40,
  tokenSize: { min: 1, max: 1 },
});
const models = createModels();
models.setProvider(faux.provider);
let gate: ReturnType<typeof Promise.withResolvers<void>> | undefined;
let toolGate: ReturnType<typeof Promise.withResolvers<void>> | undefined;
const toolName = `tool_${crypto.randomUUID().replaceAll("-", "")}`;
const registry = createRegistry();
const files = new Files(database);
const fileExtension = files.extension();
registry.install({
  ...fileExtension,
  tools: fileExtension.tools?.map((tool) => ({
    ...tool,
    async execute(args, api, context) {
      if (toolGate) {
        const waiting = toolGate;
        const release = () => waiting.resolve();
        context.abortSignal?.addEventListener("abort", release, { once: true });
        try {
          await waiting.promise;
        } finally {
          context.abortSignal?.removeEventListener("abort", release);
        }
      }
      return tool.execute(args, api, context);
    },
  })),
});
registry.install(
  defineExtension({
    name: "test-tools",
    tools: [
      defineTool({
        name: toolName,
        description: "Return the supplied text.",
        parameters: Type.Object({
          text: Type.String(),
          fail: Type.Optional(Type.Boolean()),
        }),
        execute: async (args) => {
          if (toolGate) await toolGate.promise;
          return {
            output: [{ type: "text", text: args.text }],
            isError: args.fail ?? false,
          };
        },
      }),
    ],
  }),
);
const answer: FauxResponseFactory = async (input, options, _state, model) => {
  faux.appendResponses([answer]);
  const waiting = gate;
  gate = undefined;
  if (waiting) {
    options?.signal?.addEventListener("abort", () => waiting.resolve(), {
      once: true,
    });
    await waiting.promise;
  }
  const user = [...input.messages]
    .reverse()
    .find((message) => message.role === "user");
  const content = typeof user?.content === "string" ? user.content : "";
  return fauxAssistantMessage(
    `已收到：${content}。这是一条用于验证流式显示和会话恢复的完整回复。（${model.id}）`,
  );
};
faux.setResponses([answer]);
const { harness, bots } = await openAgent(
  database,
  {
    models,
    registry,
    env: ({ conversationId }) => files.workspace(conversationId),
  },
  { model: { provider: "faux", modelId: "faux-1" } },
  BACKGROUND_CONTEXT,
);
const server = createServer(
  getRequestListener(createApp(bots, models, files).fetch),
);
server.listen(Number(process.argv[3] ?? 0), "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address === "object")
    process.send?.({ type: "ready", port: address.port, toolName });
});
let release: (() => void) | undefined;
process.on("message", (message) => {
  if (
    typeof message === "object" &&
    message !== null &&
    "responses" in message &&
    Array.isArray(message.responses)
  ) {
    faux.setResponses([
      ...message.responses.map((item) =>
        fauxAssistantMessage(item.content, {
          stopReason: item.stopReason ?? "stop",
        }),
      ),
      answer,
    ]);
    process.send?.({ type: "scripted" });
  } else if (
    typeof message === "object" &&
    message !== null &&
    "content" in message &&
    (typeof message.content === "string" || Array.isArray(message.content))
  ) {
    faux.setResponses([
      fauxAssistantMessage(message.content, {
        stopReason:
          "stopReason" in message && message.stopReason === "toolUse"
            ? "toolUse"
            : "stop",
      }),
      answer,
    ]);
    process.send?.({ type: "scripted" });
  } else if (message === "gate-tool") {
    toolGate = Promise.withResolvers<void>();
    release = toolGate.resolve;
    process.send?.({ type: "gated" });
  } else if (message === "gate") {
    gate = Promise.withResolvers<void>();
    release = gate.resolve;
    process.send?.({ type: "gated" });
  } else if (message === "release") {
    release?.();
    process.send?.({ type: "released" });
  }
});
process.on("disconnect", () => {
  server.closeAllConnections();
  server.close();
  void harness.close(BACKGROUND_CONTEXT);
});
