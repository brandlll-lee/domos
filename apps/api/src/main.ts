import { createServer } from "node:http";
import { openChat } from "@domos/agent/chat";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { getRequestListener } from "@hono/node-server";
import { createApp } from "./app.ts";

async function main() {
  const { harness, conversation } = await openChat(
    "data/agent.sqlite",
    BACKGROUND_CONTEXT,
  );
  const server = createServer(
    getRequestListener(createApp(conversation).fetch),
  );
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    server.close();
    server.closeAllConnections();
    await harness.close(BACKGROUND_CONTEXT);
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
  server.once("error", () => {
    console.error("服务启动失败。请检查端口和数据目录。");
    process.exitCode = 1;
    void close();
  });
  server.listen(4310, "127.0.0.1", () => {
    console.log("Domos: http://127.0.0.1:4310");
  });
}

main().catch(() => {
  console.error("启动失败。请检查 DEEPSEEK_API_KEY 和数据目录。");
  process.exitCode = 1;
});
