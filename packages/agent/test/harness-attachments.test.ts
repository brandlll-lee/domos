import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, defineExtension } from "@earendil-works/pi-durable";
import { expect, onTestFinished, test } from "vitest";
import { chatView } from "../src/chat-view.ts";
import type { Computers } from "../src/computer/catalog.ts";
import { Files } from "../src/files.ts";
import { EngineExecution, Engines, engineTask } from "../src/harness/index.ts";
import { openAgent } from "../src/open-agent.ts";
import { ProtocolProcess } from "./fixtures/engine-process.ts";

test("a durable chat submission reads the stored image and sends its bytes to the engine", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-image-turn-"));
  const database = join(directory, "agent.sqlite");
  const files = new Files(database);
  const worker = new ProtocolProcess();
  const computers = {
    preflight: async () => {},
    computerId: async () => "local",
    process: async () => worker,
    tools: { catalog: async () => [], finish: () => {} },
  } as unknown as Computers;
  const execution = new EngineExecution(computers, undefined, undefined, files);
  const registry = createRegistry();
  registry.install(
    defineExtension({ name: "domos-engines", tasks: [engineTask(execution)] }),
  );
  worker.receive = (request) => {
    if (request.method === "thread/start")
      worker.response(request, { thread: { id: "native" } });
    else if (request.method === "turn/start") {
      worker.response(request, { turn: { id: "turn" } });
      worker.frame({
        method: "turn/completed",
        params: { turn: { status: "completed" } },
      });
    } else if (request.id !== undefined) worker.response(request, {});
  };
  const runtime = await openAgent(
    database,
    { registry, models: createModels() },
    {},
    context,
    files,
  );
  onTestFinished(async () => {
    await runtime.harness.close(context);
    await worker.close();
    await rm(directory, { recursive: true, force: true });
  });
  const engines = new Engines(runtime.harness, execution);
  const botId = runtime.conversation.id;
  await engines.configure(
    botId,
    {
      config: { provider: "codex", model: null },
      revision: 0,
      requestId: crypto.randomUUID(),
    },
    context,
  );
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  );
  const attachment = await files.upload(botId, "screen.png", bytes, context);
  const submission = await engines.submit(
    botId,
    {
      text: "Describe",
      requestId: crypto.randomUUID(),
      attachments: [attachment],
    },
    context,
  );
  expect(await submission.wait(context)).toMatchObject({ status: "done" });
  expect(
    worker.requests.find((request) => request.method === "turn/start")?.params
      ?.input,
  ).toContainEqual({
    type: "image",
    url: `data:image/png;base64,${bytes.toString("base64")}`,
  });
});

test("computer screenshots remain downloadable with their source after the turn completes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-evidence-"));
  const database = join(directory, "agent.sqlite");
  const files = new Files(database);
  const worker = new ProtocolProcess();
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  );
  let returned: unknown;
  const execution = new EngineExecution(
    {
      preflight: async () => {},
      computerId: async () => "local",
      process: async (
        _bot: number,
        _tools: unknown,
        invoke: (
          id: string,
          name: string,
          args: object,
          signal: AbortSignal,
        ) => Promise<unknown>,
      ) => {
        worker.receive = (request) => {
          if (request.method === "thread/start")
            worker.response(request, { thread: { id: "native" } });
          else if (request.method === "turn/start") {
            worker.response(request, { turn: { id: "turn" } });
            void invoke(
              "capture",
              "browser_observe",
              {},
              new AbortController().signal,
            ).then((result) => {
              returned = result;
              worker.frame({
                method: "turn/completed",
                params: { turn: { status: "completed" } },
              });
            });
          } else if (request.id !== undefined) worker.response(request, {});
        };
        return worker;
      },
      tools: {
        catalog: async () => [
          {
            name: "browser_observe",
            description: "Observe",
            inputSchema: { type: "object" },
          },
        ],
        invoke: async () => ({
          content: [
            {
              type: "image",
              mimeType: "image/png",
              data: bytes.toString("base64"),
            },
          ],
          structuredContent: {
            source: {
              url: "https://example.org/report",
              capturedAt: "2026-10-19T12:00:00.000Z",
            },
          },
        }),
        finish: () => {},
      },
    } as unknown as Computers,
    undefined,
    undefined,
    files,
  );
  const registry = createRegistry();
  registry.install(
    defineExtension({ name: "domos-engines", tasks: [engineTask(execution)] }),
  );
  const runtime = await openAgent(
    database,
    { registry, models: createModels() },
    {},
    context,
    files,
  );
  onTestFinished(async () => {
    await runtime.harness.close(context);
    await worker.close();
    await rm(directory, { recursive: true, force: true });
  });
  const botId = runtime.conversation.id;
  const engines = new Engines(runtime.harness, execution);
  await engines.configure(
    botId,
    {
      config: { provider: "codex", model: null },
      revision: 0,
      requestId: crypto.randomUUID(),
    },
    context,
  );
  expect(
    await (
      await engines.submit(
        botId,
        { text: "Capture", requestId: crypto.randomUUID() },
        context,
      )
    ).wait(context),
  ).toMatchObject({ status: "done" });
  const state = await runtime.conversation.viewState(context);
  try {
    const file = chatView(state.value).messages.flatMap(
      (message) => message.attachments ?? [],
    )[0];
    expect(file?.source).toMatchObject({
      url: "https://example.org/report",
      capturedAt: "2026-10-19T12:00:00.000Z",
      tool: "browser_observe",
      callId: "capture",
    });
    if (!file) throw new Error("Evidence required");
    expect(
      Buffer.from(await (await files.download(botId, file.id)).arrayBuffer()),
    ).toEqual(bytes);
    expect(returned).toMatchObject({
      content: [{ type: "image", mimeType: "image/png" }],
      structuredContent: { evidence: [{ id: file.id }] },
    });
  } finally {
    state.dispose();
  }
});
