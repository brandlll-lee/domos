import { createServer } from "node:http";
import { openAgent } from "@domos/agent";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  type FauxResponseFactory,
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai/providers/faux";
import { createRegistry } from "@earendil-works/pi-durable";
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
const { harness, conversation } = await openAgent(
  database,
  { models, registry: createRegistry() },
  { model: { provider: "faux", modelId: "faux-1" } },
  BACKGROUND_CONTEXT,
);
const server = createServer(
  getRequestListener(createApp(conversation, models).fetch),
);
server.listen(Number(process.argv[3] ?? 0), "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address === "object")
    process.send?.({ type: "ready", port: address.port });
});
let release: (() => void) | undefined;
process.on("message", (message) => {
  if (message === "gate") {
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
