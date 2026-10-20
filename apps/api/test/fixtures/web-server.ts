import { createServer } from "node:http";
import { dirname } from "node:path";
import { openAgent } from "@domos/agent";
import { Computers } from "@domos/agent/computer/catalog";
import { parseConfig } from "@domos/agent/config";
import { Files } from "@domos/agent/files";
import { Sessions } from "@domos/hosting/sessions";
import { HostingStore } from "@domos/hosting/store";
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
import { EngineMessage } from "../../../../packages/agent/src/harness/state.ts";
import { featureProcess } from "../../../../packages/agent/test/fixtures/feature-process.ts";
import { createApp } from "../../src/app.ts";
import { hostingApp } from "../../src/hosting/routes.ts";

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
const computer = new Computers(
  parseConfig(
    {
      model: { provider: "faux", modelId: "faux-1" },
      dataDir: dirname(database),
    },
    database,
  ),
);
const native = process.argv[4] === "native";
const computers = native
  ? new Proxy(computer, {
      get(target, key) {
        if (key === "process") return async () => featureProcess();
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    })
  : undefined;
const { harness, bots, work, engines } = await openAgent(
  database,
  {
    models,
    registry,
    computers,
    legacy: true,
    env: ({ conversationId }) => files.workspace(conversationId),
  },
  { model: { provider: "faux", modelId: "faux-1" } },
  BACKGROUND_CONTEXT,
);
await computer.initialize(harness, bots, BACKGROUND_CONTEXT, true);
const app = createApp(bots, models, files, work, computer, undefined, engines);
let hosted: ReturnType<typeof hostingApp> | undefined;
const store =
  process.argv[4] === "hosting"
    ? await HostingStore.open(dirname(database))
    : undefined;
const sessions = store ? new Sessions(store) : undefined;
const server = createServer((request, response) =>
  getRequestListener(hosted?.app.fetch ?? app.fetch)(request, response),
);
server.listen(Number(process.argv[3] ?? 0), "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address === "object") {
    if (sessions)
      hosted = hostingApp({
        config: parseConfig(
          {
            model: { provider: "faux", modelId: "faux-1" },
            host: "127.0.0.1",
            port: address.port,
            dataDir: dirname(database),
          },
          database,
        ),
        sessions,
        models,
        forward: async (request) => app.fetch(request),
      });
    process.send?.({
      type: "ready",
      port: address.port,
      toolName,
      pairing: sessions?.pairing("admin").code,
    });
  }
});
let release: (() => void) | undefined;
process.on("message", async (message) => {
  if (
    typeof message === "object" &&
    message !== null &&
    "history" in message &&
    typeof message.history === "number"
  ) {
    const count = message.history;
    const bot = (await bots.list(BACKGROUND_CONTEXT))[0];
    if (!bot) throw new Error("Bot required");
    await harness.commit(async (tx) => {
      for (let index = 0; index < count; index++) {
        const turnId = `history:${index}`;
        for (const role of ["user", "assistant"] as const)
          await tx.appendEntry(bot.id, {
            kind: EngineMessage,
            data: {
              id: `${turnId}:${role}`,
              turnId,
              role,
              stopped: false,
              content: [
                {
                  type: "text",
                  key: `${turnId}:${role}:text`,
                  text:
                    role === "user"
                      ? `历史任务 ${index + 1}`
                      : `## 报告 ${index + 1}\n\n**资料已核对。**\n\n- 第一项结果\n- 第二项结果`,
                },
              ],
            },
          });
      }
    }, BACKGROUND_CONTEXT);
    process.send?.({ type: "seeded" });
  } else if (
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
  } else if (message === "disconnect-computer") {
    await computer.close(BACKGROUND_CONTEXT);
    process.send?.({ type: "computer-disconnected" });
  }
});
process.on("disconnect", () => {
  server.closeAllConnections();
  server.close();
  hosted?.close();
  void (async () => {
    await computer.close(BACKGROUND_CONTEXT);
    await harness.close(BACKGROUND_CONTEXT);
    await store?.close();
  })().finally(() => process.exit());
});
