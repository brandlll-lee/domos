import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";
import { historyProjection } from "./native-history.mjs";

const outputLimit = 8000;

export async function openHttpService(emit, limits) {
  const endpoint = Promise.withResolvers();
  const abort = new AbortController();
  const password = randomBytes(32).toString("hex");
  let output = "";
  const timer = setTimeout(
    () => endpoint.reject(new Error("Service unavailable")),
    limits.readyMs,
  );
  timer.unref();
  void endpoint.promise.catch(() => {});
  let port;
  if (limits.listen) {
    const server = createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    void (async () => {
      const address = `http://127.0.0.1:${port}`;
      while (!abort.signal.aborted) {
        try {
          const health = await fetch(`${address}/global/health`, {
            headers: {
              Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
            },
            signal: AbortSignal.any([
              abort.signal,
              AbortSignal.timeout(Math.min(limits.timeoutMs, 1000)),
            ]),
          });
          await health.body?.cancel();
          if (health.ok) {
            clearTimeout(timer);
            endpoint.resolve(address);
            return;
          }
        } catch {}
        await delay(100, undefined, { signal: abort.signal });
      }
    })().catch(() => {});
  }
  void endpoint.promise.catch(() => abort.abort());
  return {
    password,
    port,
    capture(data) {
      if (limits.listen) return;
      output = (output + stripVTControlCharacters(data)).slice(-outputLimit);
      const address = output.match(/http:\/\/127\.0\.0\.1:\d+(?=[\s/])/)?.[0];
      if (address) {
        clearTimeout(timer);
        endpoint.resolve(address);
      }
    },
    async request(frame) {
      let message = "OpenCode 本地接口路径或方法不受支持。";
      try {
        if (
          typeof frame.path !== "string" ||
          !(
            /^\/(?:provider(?:\/|$)|auth\/)/.test(frame.path) ||
            (frame.method === "GET" &&
              /^\/session\/[A-Za-z0-9_-]+\/message(?:\?limit=(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-6]))?$/.test(
                frame.path,
              ))
          ) ||
          frame.path.includes("..") ||
          !["GET", "POST", "PUT", "DELETE"].includes(frame.method)
        )
          throw new Error("Invalid request");
        message = "OpenCode 本地服务启动等待失败。请重试连接。";
        const address = await endpoint.promise;
        message = "OpenCode 本地接口连接中断。请重试连接。";
        const response = await fetch(new URL(frame.path, address), {
          method: frame.method,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
          },
          body:
            frame.body === undefined ? undefined : JSON.stringify(frame.body),
          signal: AbortSignal.any([
            abort.signal,
            AbortSignal.timeout(limits.timeoutMs),
          ]),
          redirect: "error",
        });
        message = `OpenCode 本地接口请求失败（HTTP ${response.status}）。`;
        if (!response.ok) throw new Error("Request rejected");
        message = "OpenCode 本地接口返回了无效响应。";
        const chunks = [];
        let bytes = 0;
        for await (const chunk of response.body) {
          bytes += chunk.length;
          if (bytes > 16 * 1024 * 1024) {
            message = "OpenCode 历史接口单次响应过大。原生会话已保留。";
            throw new Error("Response too large");
          }
          chunks.push(chunk);
        }
        const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        emit({
          type: "http",
          id: frame.id,
          result: frame.path.startsWith("/session/")
            ? historyProjection(result)
            : result,
        });
      } catch (error) {
        emit({
          type: "http",
          id: frame.id,
          error:
            error?.name === "TimeoutError"
              ? "OpenCode 本地接口请求超时。请重试连接。"
              : message,
        });
      }
    },
    close() {
      clearTimeout(timer);
      abort.abort();
      endpoint.reject(new Error("Connection closed"));
    },
  };
}
