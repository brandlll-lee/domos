import { spawn } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { ComputerDriver } from "@domos/agent/computer/driver";

const hash = (value: string) => createHash("sha256").update(value).digest();

export function controlServer(driver: ComputerDriver, token: string) {
  const processes = new Set<ReturnType<typeof spawn>>();
  const trusted = (request: IncomingMessage) =>
    timingSafeEqual(
      hash(request.headers.authorization ?? ""),
      hash(`Bearer ${token}`),
    );
  let pending: Promise<unknown> = Promise.resolve();
  let closing: Promise<void> | undefined;
  const actions = {
    start: () => driver.start(),
    stop: () => driver.stop(),
    rebuild: () => driver.rebuild(),
  };
  const status = async () => {
    const state = await driver.inspect();
    if (state === "running") await driver.checkNetwork();
    return { state, network: driver.config.network };
  };
  const change = (action: () => Promise<void>) => {
    const result = pending
      .catch(() => {})
      .then(async () => {
        for (const child of processes) child.kill();
        await action();
        return status();
      });
    pending = result;
    return result;
  };
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    if (!trusted(request)) {
      response.writeHead(401).end("{}");
      return;
    }
    try {
      const path = request.url ?? "";
      if (request.method === "GET" && path === `/${driver.config.id}/status`) {
        await pending.catch(() => {});
        response.end(JSON.stringify(await status()));
        return;
      }
      const action = Object.entries(actions).find(
        ([name]) => path === `/${driver.config.id}/${name}`,
      )?.[1];
      if (request.method !== "POST" || !action) {
        response.writeHead(404).end("{}");
        return;
      }
      response.end(JSON.stringify(await change(action)));
    } catch {
      response
        .writeHead(503)
        .end(JSON.stringify({ error: "工作电脑操作未完成。请核对状态。" }));
    }
  });
  server.on("connect", async (request, socket, head) => {
    socket.on("error", () => socket.destroy());
    const daemonToken = request.headers["x-domos-daemon-token"];
    if (
      !trusted(request) ||
      request.url !== `/${driver.config.id}/daemon` ||
      typeof daemonToken !== "string" ||
      !/^[a-f0-9]{32,128}$/.test(daemonToken)
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    try {
      await pending;
      if ((await driver.inspect()) !== "running") throw new Error("Stopped");
      await driver.checkNetwork();
      const [program, ...args] = await driver.daemon();
      if (!program) throw new Error("Daemon required");
      const child = spawn(program, [...args, "serve", "--token", daemonToken], {
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
      });
      processes.add(child);
      child.once("spawn", () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) child.stdin.write(head);
        socket.pipe(child.stdin);
        child.stdout.pipe(socket);
      });
      child.once("error", () => {
        processes.delete(child);
        socket.destroy();
      });
      child.once("exit", () => {
        processes.delete(child);
        socket.end();
      });
      socket.once("close", () => {
        child.stdin.end();
        child.kill();
      });
    } catch {
      socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n");
    }
  });
  return {
    server,
    start: () => change(actions.start),
    close() {
      closing ??= (async () => {
        for (const child of processes) child.kill();
        await pending.catch(() => {});
        server.close();
        server.closeAllConnections();
        await driver.stop();
      })();
      return closing;
    },
  };
}
