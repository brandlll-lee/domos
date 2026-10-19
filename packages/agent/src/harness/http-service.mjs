import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";

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
            signal: abort.signal,
          });
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
      output = (output + stripVTControlCharacters(data)).slice(-outputLimit);
      const address = output.match(/http:\/\/127\.0\.0\.1:\d+(?=[\s/])/)?.[0];
      if (address) {
        clearTimeout(timer);
        endpoint.resolve(address);
      }
    },
    async request(frame) {
      try {
        if (
          typeof frame.path !== "string" ||
          !(
            /^\/(?:provider(?:\/|$)|auth\/)/.test(frame.path) ||
            (frame.method === "GET" &&
              /^\/session\/[A-Za-z0-9_-]+\/message$/.test(frame.path))
          ) ||
          frame.path.includes("..") ||
          !["GET", "POST", "PUT", "DELETE"].includes(frame.method)
        )
          throw new Error("Invalid request");
        const address = await endpoint.promise;
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
        if (!response.ok) throw new Error("Request rejected");
        emit({ type: "http", id: frame.id, result: await response.json() });
      } catch {
        emit({
          type: "http",
          id: frame.id,
          error: "连接未完成。请检查账号后重试。",
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
