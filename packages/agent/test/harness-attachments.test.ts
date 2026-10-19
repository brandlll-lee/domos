import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, defineExtension } from "@earendil-works/pi-durable";
import { expect, onTestFinished, test } from "vitest";
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
