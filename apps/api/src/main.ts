import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { openHostedRuntime } from "./hosting/runtime.ts";

async function main() {
  const runtime = await openHostedRuntime();
  const { config } = runtime;
  const server = createServer(getRequestListener(runtime.app.fetch));
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
