import assert from "node:assert/strict";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { expect, test } from "vitest";
import { modelDiagnostics } from "../src/runtime/model-diagnostics.ts";

const models = builtinModels();
const model = models.getModels("deepseek")[0];
assert.ok(model);
const messages = [
  { role: "user" as const, content: "private prompt", timestamp: 0 },
];
const observed = modelDiagnostics(models);
const run = (fetch: typeof globalThis.fetch, signal?: AbortSignal) =>
  observed
    .streamSimple(
      model,
      { messages },
      { apiKey: "fixture-key", fetch, signal, maxRetries: 0 },
    )
    .result();
const event = (delta: object, finish_reason: string | null = null) =>
  `data: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
const answer = () =>
  new Response(
    `${event({ content: "Done" })}${event({}, "stop")}data: [DONE]\n\n`,
    {
      headers: {
        "content-type": "text/event-stream",
        "x-request-id": "request-42",
        "set-cookie": "private-cookie",
      },
    },
  );

test.each(["ECONNRESET", "ENOTFOUND", "CERT_HAS_EXPIRED"])(
  "Pi retains %s without request or error secrets",
  async (code) => {
    const cause = Object.assign(
      new Error(
        "private-cookie https://user:secret@models.example/path?key=secret",
      ),
      { code },
    );
    cause.cause = cause;
    const message = await run(async () => {
      throw new Error("private prompt fixture-key", { cause });
    });
    expect(message.stopReason).toBe("error");
    const diagnostic = message.diagnostics?.find(
      (d) => d.type === "domos.model-request",
    );
    const stored = JSON.stringify(diagnostic);
    expect(stored).toContain(code);
    expect(stored).not.toMatch(/private|fixture-key|cookie|\/path|secret/);
    expect(Buffer.byteLength(stored)).toBeLessThanOrEqual(4096);
  },
);

test.each([401, 429, 503])(
  "Pi records HTTP %s and its safe request reference",
  async (status) => {
    const message = await run(
      async () =>
        new Response("private response", {
          status,
          headers: { "x-request-id": "request-42" },
        }),
    );
    const stored = JSON.stringify(message.diagnostics);
    expect(message.stopReason).toBe("error");
    expect(stored).toContain(`"status":${status}`);
    expect(stored).toContain("request-42");
    expect(stored).not.toContain("private response");
  },
);

test("Pi records a response-body failure after successful HTTP headers", async () => {
  let first = true;
  const message = await run(
    async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            if (first) {
              first = false;
              controller.enqueue(
                new TextEncoder().encode(event({ content: "Partial" })),
              );
            } else
              controller.error(
                Object.assign(new Error("private body"), {
                  code: "ECONNRESET",
                }),
              );
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  expect(message.stopReason).toBe("error");
  expect(JSON.stringify(message.diagnostics)).toMatch(/"phase":"body"/);
  expect(JSON.stringify(message.diagnostics)).toContain("ECONNRESET");
});

test("observation preserves Pi response callbacks, content and cancellation", async () => {
  let responses = 0;
  const stream = observed.streamSimple(
    model,
    { messages },
    {
      apiKey: "fixture-key",
      fetch: async () => answer(),
      maxRetries: 0,
      onResponse: () => {
        responses++;
      },
    },
  );
  const message = await stream.result();
  expect(message.content).toEqual([{ type: "text", text: "Done" }]);
  expect(responses).toBe(1);
  expect(JSON.stringify(message.diagnostics)).not.toContain("private-cookie");
  const controller = new AbortController();
  const entered = Promise.withResolvers<void>();
  const cancelled = run(
    async (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        );
        entered.resolve();
      }),
    controller.signal,
  );
  await entered.promise;
  controller.abort();
  expect((await cancelled).stopReason).toBe("aborted");
});
