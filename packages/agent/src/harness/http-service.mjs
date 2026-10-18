import { randomBytes } from "node:crypto";
import { stripVTControlCharacters } from "node:util";

const outputLimit = 8000;

export function openHttpService(emit, limits) {
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
  return {
    password,
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
          !/^\/(?:provider(?:\/|$)|auth\/)/.test(frame.path) ||
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
