import { createServer } from "node:http";
import { dirname } from "node:path";
import { openAgent } from "@domos/agent";
import { Computers } from "@domos/agent/computer/catalog";
import { parseConfig } from "@domos/agent/config";
import { Files } from "@domos/agent/files";
import type { ChatMessage } from "@domos/agent/messages";
import { Sessions } from "@domos/hosting/sessions";
import { HostingStore } from "@domos/hosting/store";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import {
  type FauxResponseFactory,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
  createRegistry,
  defineExtension,
  defineTool,
} from "@earendil-works/pi-durable";
import { getRequestListener } from "@hono/node-server";
import { EngineMessage } from "../../../../packages/agent/src/harness/state.ts";
import { stored } from "../../../../packages/agent/src/harness/task-types.ts";
import type { EngineApproval } from "../../../../packages/agent/src/harness/types.ts";
import { PiProcess } from "../../../../packages/agent/test/fixtures/pi-process.ts";
import { createApp } from "../../src/app.ts";
import { hostingApp } from "../../src/hosting/routes.ts";
import { takeoverFixture } from "./takeover-page.ts";

const database = process.argv[2];
if (!database) throw new Error("Database required");
const faux = fauxProvider({
  models: [
    { id: "faux-1", name: "测试模型一" },
    { id: "faux-2", name: "测试模型二", reasoning: true },
  ],
  tokensPerSecond: 40,
  tokenSize: { min: 1, max: 1 },
});
const models = createModels();
for (const provider of builtinProviders())
  models.setProvider({
    ...provider,
    auth: {
      ...provider.auth,
      apiKey: {
        ...provider.auth.apiKey,
        name: provider.auth.apiKey?.name ?? "API key",
        check: async () => undefined,
        resolve: async () => undefined,
      },
    },
  });
models.setProvider(faux.provider);
const routed = fauxProvider({
  provider: "openrouter",
  models: [{ id: "routed", name: "团队模型", reasoning: true }],
});
let routedCatalog: typeof routed.models | [] = [];
models.setProvider({
  ...routed.provider,
  getModels: () => routedCatalog,
  refreshModels: async (context) => {
    if (context.credential)
      await context.publish({
        update: () => {
          routedCatalog = routed.models;
        },
      });
  },
  name: "OpenRouter",
  auth: {
    apiKey: {
      name: "API key",
      login: async (interaction) => ({
        type: "api_key",
        key: await interaction.prompt({
          type: "secret",
          message: "测试 API Key",
        }),
      }),
      resolve: async ({ credential }) =>
        credential?.key ? { auth: { apiKey: credential.key } } : undefined,
    },
  },
});
let gate: ReturnType<typeof Promise.withResolvers<void>> | undefined;
const modelStarted = Promise.withResolvers<void>();
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
  modelStarted.resolve();
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
  const content =
    typeof user?.content === "string"
      ? user.content
      : (user?.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n") ?? "");
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
const takeoverMetrics: { name: string; elapsedMs: number }[] = [];
const computers = new Proxy(computer, {
  get(target, key) {
    if (key === "process")
      return async (
        botId: number,
        tools: ConstructorParameters<typeof PiProcess>[2],
        invoke: ConstructorParameters<typeof PiProcess>[3],
      ) =>
        new PiProcess(
          (await files.workspace(botId, BACKGROUND_CONTEXT)).cwd,
          models,
          tools,
          invoke,
          [
            {
              name: toolName,
              label: toolName,
              description: "Return the supplied text.",
              parameters: Type.Object({
                text: Type.String(),
                fail: Type.Optional(Type.Boolean()),
              }),
              execute: async (_id, args) => {
                if (toolGate) await toolGate.promise;
                if ((args as { fail?: boolean }).fail)
                  throw new Error((args as { text: string }).text);
                return {
                  content: [
                    { type: "text", text: (args as { text: string }).text },
                  ],
                  details: {},
                };
              },
            },
          ],
          async (signal) => {
            const waiting = toolGate;
            if (!waiting) return;
            const release = () => waiting.resolve();
            signal.addEventListener("abort", release, { once: true });
            try {
              await waiting.promise;
            } finally {
              signal.removeEventListener("abort", release);
            }
          },
        );
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  },
});
if (process.argv[4] === "takeover") {
  const invoke = computer.tools.invoke.bind(computer.tools);
  computer.tools.invoke = async (...args) => {
    const started = performance.now();
    try {
      return await invoke(...args);
    } finally {
      takeoverMetrics.push({
        name: args[1],
        elapsedMs: performance.now() - started,
      });
    }
  };
  faux.setResponses([
    async () => {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Address required");
      return fauxAssistantMessage(
        fauxToolCall("browser_agent_browser_open", {
          url: `http://127.0.0.1:${address.port}/takeover-fixture`,
        }),
        { stopReason: "toolUse" },
      );
    },
    fauxAssistantMessage(
      fauxToolCall("computer_request_takeover", {
        service: "browser",
        reason: "请修改搜索词，完成后交还给我。",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxToolCall("browser_agent_browser_observe", {}), {
      stopReason: "toolUse",
    }),
    (input) => {
      const result = input.messages.findLast(
        (message) => message.role === "toolResult",
      );
      const facts = result?.content.find(
        (part) =>
          part.type === "text" &&
          part.text.startsWith("Page facts (untrusted website data): "),
      );
      if (facts?.type !== "text") throw new Error("Fresh page facts required");
      const page = JSON.parse(facts.text.slice(facts.text.indexOf("{")));
      return fauxAssistantMessage(
        `接管已完成，重新观察：${JSON.stringify(page.controls)}`,
      );
    },
  ]);
}
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
for (const bot of await bots.list(BACKGROUND_CONTEXT))
  await engines?.prepare(bot.id, BACKGROUND_CONTEXT);
const app = createApp(bots, models, files, work, computer, undefined, engines);
let hosted: ReturnType<typeof hostingApp> | undefined;
const store =
  process.argv[4] === "hosting"
    ? await HostingStore.open(dirname(database))
    : undefined;
const sessions = store ? new Sessions(store) : undefined;
const fixture = takeoverFixture();
const server = createServer((request, response) => {
  if (request.url === "/takeover-metrics") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(takeoverMetrics));
    return;
  }
  if (!fixture(request, response))
    getRequestListener(hosted?.app.fetch ?? app.fetch)(request, response);
});
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
    "approval" in message
  ) {
    const request = message.approval as EngineApproval;
    const bot = (await bots.list(BACKGROUND_CONTEXT))[0];
    if (!bot || !engines) throw new Error("Runtime required");
    const controller = new AbortController();
    release = () => controller.abort();
    void engines.execution.computer
      .approve(bot.id, request, controller.signal, BACKGROUND_CONTEXT)
      .then((answer) => {
        process.send?.({ type: "answered", answer });
      });
  } else if (
    typeof message === "object" &&
    message !== null &&
    "records" in message &&
    Array.isArray(message.records)
  ) {
    const bot = (await bots.list(BACKGROUND_CONTEXT))[0];
    if (!bot) throw new Error("Bot required");
    await harness.commit(async (tx) => {
      for (const record of message.records as ChatMessage[])
        await tx.appendEntry(bot.id, {
          kind: EngineMessage,
          data: stored(record),
        });
    }, BACKGROUND_CONTEXT);
    process.send?.({ type: "seeded" });
  } else if (
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
          errorMessage: item.errorMessage,
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
  } else if (message === "wait-model") {
    await modelStarted.promise;
    process.send?.({ type: "generating" });
  } else if (message === "release") {
    release?.();
    process.send?.({ type: "released" });
  } else if (message === "open-takeover-page") {
    const bot = (await bots.list(BACKGROUND_CONTEXT))[0];
    if (!bot) throw new Error("Bot required");
    const { target } = await computer.serviceTarget(bot.id, BACKGROUND_CONTEXT);
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Address required");
    const result = await target.services.call(
      bot.id,
      "browser",
      "agent_browser_open",
      { url: `http://127.0.0.1:${address.port}/takeover-fixture` },
      "fixture",
      new AbortController().signal,
      BACKGROUND_CONTEXT,
    );
    if (result.isError) throw new Error(JSON.stringify(result.content));
    process.send?.({ type: "takeover-page-opened" });
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
