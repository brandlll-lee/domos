import type { AssistantMessage, JsonObject } from "@earendil-works/pi-ai";
import type { Models } from "@earendil-works/pi-ai/models";

type RequestEvidence = {
  attempt: number;
  phase: string;
  elapsedMs: number;
  headersMs?: number;
  host?: string;
  status?: number;
  requestId?: string;
  causes?: { name: string; code?: string }[];
};
const observedApis = new Set([
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
]);
const tag = (value: unknown) =>
  typeof value === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(value)
    ? value
    : undefined;

function causes(error: unknown) {
  const result: NonNullable<RequestEvidence["causes"]> = [];
  const seen = new Set();
  while (error instanceof Error && !seen.has(error) && result.length < 3) {
    seen.add(error);
    result.push({
      name: [
        "Error",
        "TypeError",
        "TimeoutError",
        "AbortError",
        "AggregateError",
      ].includes(error.name)
        ? error.name
        : "Error",
      ...(tag((error as Error & { code?: unknown }).code)
        ? { code: tag((error as Error & { code?: unknown }).code) }
        : {}),
    });
    error = error.cause;
  }
  return result;
}

export function modelDiagnostics(models: Models): Models {
  const streamSimple: Models["streamSimple"] = (model, context, options) => {
    const requests: RequestEvidence[] = [];
    const start = performance.now();
    let requestStarted = start;
    let attempt = 0;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const request: RequestEvidence = {
        attempt: ++attempt,
        phase: "connect",
        elapsedMs: 0,
      };
      requests.push(request);
      if (requests.length > 3) requests.shift();
      const started = performance.now();
      requestStarted = started;
      const finish = (error?: unknown) => {
        request.elapsedMs = Math.round(performance.now() - started);
        if (error !== undefined) request.causes = causes(error);
      };
      try {
        request.host = new URL(
          input instanceof Request ? input.url : String(input),
        ).hostname.slice(0, 253);
        const response = await (options?.fetch ?? globalThis.fetch)(
          input,
          init,
        );
        request.status = response.status;
        request.phase = "headers";
        const id =
          response.headers.get("x-request-id") ??
          response.headers.get("request-id");
        if (id && /^[\w.:-]{1,96}$/.test(id) && !/^(sk-|eyJ|Bearer)/i.test(id))
          request.requestId = id;
        finish();
        request.headersMs = request.elapsedMs;
        if (!response.body) return response;
        const reader = response.body.getReader();
        const body = new ReadableStream<Uint8Array>(
          {
            async pull(controller) {
              request.phase = "body";
              try {
                const next = await reader.read();
                if (next.done) {
                  request.phase = "complete";
                  finish();
                  controller.close();
                  reader.releaseLock();
                } else controller.enqueue(next.value);
              } catch (error) {
                finish(error);
                controller.error(error);
                reader.releaseLock();
              }
            },
            cancel: (reason) => reader.cancel(reason),
          },
          { highWaterMark: 0 },
        );
        const observed = new Response(body, response);
        for (const key of ["url", "redirected", "type"] as const)
          Object.defineProperty(observed, key, { value: response[key] });
        return observed;
      } catch (error) {
        finish(error);
        throw error;
      }
    };
    const http =
      observedApis.has(model.api) &&
      !options?.transport?.startsWith("websocket");
    const stream = models.streamSimple(model, context, {
      ...options,
      ...(http ? { fetch } : {}),
    });
    void stream.result().then((message) => {
      const last = requests.at(-1);
      if (last && !last.causes) {
        last.elapsedMs = Math.round(performance.now() - requestStarted);
        if (message.stopReason !== "error")
          last.phase =
            message.stopReason === "aborted" ? "aborted" : "complete";
      }
      const diagnostic = {
        type: "domos.model-request",
        timestamp: Date.now(),
        details: {
          provider: model.provider.slice(0, 128),
          model: model.id.slice(0, 128),
          elapsedMs: Math.round(performance.now() - start),
          requests,
        } as JsonObject,
      };
      while (Buffer.byteLength(JSON.stringify(diagnostic)) > 4096)
        requests.shift();
      message.diagnostics = [...(message.diagnostics ?? []), diagnostic];
    });
    return stream;
  };
  return new Proxy(models, {
    get(target, key) {
      if (key === "streamSimple") return streamSimple;
      if (key === "completeSimple")
        return (...args: Parameters<Models["completeSimple"]>) =>
          streamSimple(...args).result();
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function modelFailure(message: AssistantMessage, reference: string) {
  const diagnostic = message.diagnostics?.findLast(
    (item) => item.type === "domos.model-request",
  );
  const request = (
    diagnostic?.details?.requests as RequestEvidence[] | undefined
  )?.at(-1);
  const code = request?.causes?.findLast((item) => item.code)?.code;
  const status = request?.status;
  const summary =
    status === 401
      ? "模型账号认证失败"
      : status === 403
        ? "模型服务拒绝访问"
        : status === 429
          ? "模型服务限流"
          : status && status >= 500
            ? "模型服务暂时不可用"
            : message.errorMessage === "Connection error." || code
              ? "连接失败，原因待确认"
              : "回复失败，原因待确认";
  return `${summary}${code ? `（${code}）` : ""}〔${reference}〕`;
}
