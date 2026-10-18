import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { ComputerDriver } from "@domos/agent/computer/driver";
import { identifier } from "@domos/agent/config";
import { ControlTarget } from "./target.ts";

const hash = (value: string) => createHash("sha256").update(value).digest();

export function controlServer(
  driver: ComputerDriver,
  token: string,
  create?: (id: string) => ComputerDriver,
) {
  const targets = new Map([[driver.config.id, new ControlTarget(driver)]]);
  let closing: Promise<void> | undefined;
  const trusted = (request: IncomingMessage) =>
    !closing &&
    timingSafeEqual(
      hash(request.headers.authorization ?? ""),
      hash(`Bearer ${token}`),
    );
  const target = (path: string) => {
    const match =
      /^\/([^/]+)\/(status|start|stop|rebuild|daemon|process)$/.exec(path);
    if (!match || !identifier.safeParse(match[1]).success) return;
    const id = match[1] as string;
    let value = targets.get(id);
    if (!value && create) {
      value = new ControlTarget(create(id));
      targets.set(id, value);
    }
    return value ? { value, action: match[2] } : undefined;
  };
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    if (!trusted(request)) {
      response.writeHead(401).end("{}");
      return;
    }
    if (request.method === "GET" && request.url === "/health") {
      response.end("{}");
      return;
    }
    const item = target(request.url ?? "");
    if (!item) {
      response.writeHead(404).end("{}");
      return;
    }
    try {
      if (request.method === "GET" && item.action === "status") {
        response.end(JSON.stringify(await item.value.status()));
      } else if (
        request.method === "POST" &&
        (item.action === "start" ||
          item.action === "stop" ||
          item.action === "rebuild")
      ) {
        response.end(JSON.stringify(await item.value.change(item.action)));
      } else response.writeHead(404).end("{}");
    } catch {
      response
        .writeHead(503)
        .end(JSON.stringify({ error: "电脑准备未完成。请重试。" }));
    }
  });
  server.on("connect", async (request, socket, head) => {
    socket.on("error", () => socket.destroy());
    const token = request.headers["x-domos-daemon-token"];
    const botId = Number(request.headers["x-domos-bot-id"]);
    const item = trusted(request) ? target(request.url ?? "") : undefined;
    if (
      !item ||
      (item.action === "process"
        ? !Number.isSafeInteger(botId) || botId < 1
        : item.action !== "daemon" ||
          typeof token !== "string" ||
          !/^[a-f0-9]{32,128}$/.test(token))
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    try {
      await item.value.connect(
        socket,
        head,
        typeof token === "string" ? token : undefined,
        item.action === "process" ? botId : undefined,
      );
    } catch {
      socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n");
    }
  });
  return {
    server,
    start: () => targets.get(driver.config.id)?.change("start"),
    close() {
      closing ??= (async () => {
        server.close();
        server.closeAllConnections();
        await Promise.all(
          [...targets.values()].map((target) => target.close()),
        );
      })();
      return closing;
    },
  };
}
