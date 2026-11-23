import { createServer } from "node:http";
import { desktopIdentity } from "@domos/hosting/desktop";
import { getRequestListener } from "@hono/node-server";
import { openHostedRuntime } from "./hosting/runtime.ts";

function report(error: unknown) {
  if (!(error instanceof Error)) return console.error("Error");
  console.error(error.name);
  if (
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z_\d]+$/.test(error.code)
  )
    console.error(`code: '${error.code}'`);
  for (const line of error.stack?.split("\n").slice(1) ?? [])
    if (line.trimStart().startsWith("at ")) console.error(line);
}

async function main() {
  if (process.versions.electron) process.env.ELECTRON_RUN_AS_NODE = "1";
  const runtime = await openHostedRuntime();
  const { config } = runtime;
  const server = createServer(getRequestListener(runtime.app.fetch));
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      server.close();
      server.closeAllConnections();
      await runtime.close();
      if (process.connected) process.disconnect();
    })());
  const shutdown = () => {
    void close().then(
      () => process.exit(),
      (error) => {
        report(error);
        process.exit(1);
      },
    );
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.on("message", (message) => {
    if (message === "shutdown") shutdown();
  });
  const parent = (
    process as NodeJS.Process & {
      parentPort?: {
        postMessage(message: unknown): void;
        on(
          event: "message",
          listener: (event: { data: unknown }) => void,
        ): void;
      };
    }
  ).parentPort;
  parent?.on("message", (event) => {
    if (event.data === "shutdown") {
      shutdown();
      return;
    }
    if (
      config.host !== "127.0.0.1" ||
      !event.data ||
      typeof event.data !== "object" ||
      !("id" in event.data) ||
      typeof event.data.id !== "string" ||
      !("type" in event.data)
    )
      return;
    const input = event.data;
    const operation = async () => {
      if (input.type === "pair-desktop" && "identity" in input)
        return runtime.pairDesktop(desktopIdentity.parse(input.identity));
      if (
        input.type === "maintenance" &&
        "held" in input &&
        typeof input.held === "boolean"
      )
        return runtime.maintenance(input.held);
      throw new Error("桌面后台请求无效。");
    };
    void operation()
      .then((result) =>
        parent.postMessage({ type: "desktop-response", id: input.id, result }),
      )
      .catch((error) =>
        parent.postMessage({
          type: "desktop-response",
          id: input.id,
          error:
            error instanceof Error ? error.message : "本机后台请求未完成。",
        }),
      );
  });
  server.once("error", (error) => {
    report(error);
    console.error("服务启动失败。请检查端口和数据目录。");
    process.exitCode = 1;
    void close().catch(report);
  });
  server.listen(config.port, config.host, () => {
    console.log(`Domos: http://${config.host}:${config.port}`);
  });
}

main().catch((error) => {
  report(error);
  console.error("启动失败。请检查模型配置、Node 版本和数据目录。");
  process.exitCode = 1;
});
