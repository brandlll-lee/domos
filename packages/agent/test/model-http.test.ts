import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { createRegistry } from "@earendil-works/pi-durable";
import { getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { expect, onTestFinished, test } from "vitest";
import { openAgent } from "../src/open-agent.ts";
import { configureModelHttp } from "../src/runtime/model-http.ts";

test("Pi HTTP initialization preserves gzip streams, Durable retry, diagnostics, and cancellation", async () => {
  const originalDispatcher = getGlobalDispatcher();
  const originals = {
    fetch,
    Headers,
    Request,
    Response,
    FormData,
    File,
    WebSocket,
    EventSource: globalThis.EventSource,
  };
  configureModelHttp();
  const configured = getGlobalDispatcher();
  configureModelHttp();
  expect(getGlobalDispatcher()).toBe(configured);
  onTestFinished(async () => {
    setGlobalDispatcher(originalDispatcher);
    Object.assign(globalThis, originals);
    await configured.close();
  });
  const directory = await mkdtemp(join(tmpdir(), "domos-model-http-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const entered = Promise.withResolvers<void>();
  const disconnected = Promise.withResolvers<void>();
  let calls = 0;
  const server = createServer((request, response) => {
    request.resume();
    if (request.url === "/cancel") {
      response.on("close", () => disconnected.resolve());
      entered.resolve();
      return;
    }
    request.on("end", () => {
      if (++calls === 1) {
        request.socket.destroy();
        return;
      }
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "content-encoding": "gzip",
        "x-request-id": "fixture-recovered",
      });
      response.end(
        gzipSync(
          'data: {"choices":[{"index":0,"delta":{"content":"Recovered"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        ),
      );
    });
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Server required");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const models = builtinModels();
  const provider = models.getProvider("deepseek");
  if (!provider) throw new Error("Provider required");
  models.setProvider({
    ...provider,
    getModels: () =>
      provider.getModels().map((model) => ({ ...model, baseUrl })),
    auth: {
      apiKey: {
        name: "Fixture",
        resolve: async () => ({ auth: { apiKey: "fixture-key" } }),
      },
    },
  });
  const context = BACKGROUND_CONTEXT;
  const runtime = await openAgent(
    join(directory, "agent.sqlite"),
    {
      models,
      registry: createRegistry(),
      settings: { retry: { baseDelayMs: 1 }, stream: { maxRetries: 0 } },
    },
    { model: { provider: "deepseek", modelId: "deepseek-flash" } },
    context,
  );
  try {
    expect(
      await (
        await runtime.conversation.submit(
          { type: "input", content: "Continue" },
          context,
        )
      ).wait(context),
    ).toMatchObject({ status: "done" });
    expect(calls).toBe(2);
    const view = await runtime.conversation.viewState(context);
    try {
      const evidence = JSON.stringify(
        view.value.entries
          .flatMap((entry) => entry.model ?? [])
          .flatMap((message) =>
            message.role === "assistant" ? (message.diagnostics ?? []) : [],
          ),
      );
      expect(evidence).toContain("fixture-recovered");
      expect(evidence).toContain("UND_ERR_SOCKET");
    } finally {
      view.dispose();
    }
    const controller = new AbortController();
    const request = fetch(`${baseUrl}/cancel`, { signal: controller.signal });
    const rejected = expect(request).rejects.toMatchObject({
      name: "AbortError",
    });
    await entered.promise;
    controller.abort();
    await rejected;
    await disconnected.promise;
  } finally {
    await runtime.harness.close(context);
  }
});
