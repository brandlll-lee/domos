import { createServer } from "node:http";
import { openChat } from "@domos/agent/chat";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { getRequestListener } from "@hono/node-server";
import { createApp } from "./app.ts";

async function main() {
  const runtime = await openChat(BACKGROUND_CONTEXT);
  const { bots, models, files, work, computer, config } = runtime;
  const server = createServer(
    getRequestListener(
      createApp(bots, models, files, work, computer, config.staticDir).fetch,
    ),
  );
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    server.close();
    server.closeAllConnections();
    await runtime.close();
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
  server.once("error", () => {
    console.error("服务启动失败。请检查端口和数据目录。");
    process.exitCode = 1;
    void close();
  });
  server.listen(config.port, config.host, () => {
    console.log(`Domos: http://${config.host}:${config.port}`);
  });
}

main().catch(() => {
  console.error("启动失败。请检查模型配置、Node 版本和数据目录。");
  process.exitCode = 1;
});
