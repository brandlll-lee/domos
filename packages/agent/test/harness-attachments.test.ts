import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { CredentialStore } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, defineExtension } from "@earendil-works/pi-durable";
import sharp from "sharp";
import { expect, onTestFinished, test } from "vitest";
import type { Attachment } from "../src/attachments.ts";
import { chatView } from "../src/chat-view.ts";
import type { Computers } from "../src/computer/catalog.ts";
import { ComputerRuntime } from "../src/computer/runtime.ts";
import { Files } from "../src/files.ts";
import { interactionExtension } from "../src/harness/interactions.ts";
import { WorkProcess } from "../src/harness/process.ts";
import { ImageServices, imageExtension } from "../src/image-services.ts";
import { openAgent } from "../src/open-agent.ts";
import {
  EngineExecution,
  Runtime as Engines,
  engineTask,
} from "../src/runtime/index.ts";
import { ProtocolProcess } from "./fixtures/engine-process.ts";

test("uploaded image references survive native dispatch, editing and question reuse without preselected IDs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-reference-turn-"));
  const database = join(directory, "agent.sqlite");
  const files = new Files(database);
  const worker = new ProtocolProcess();
  let imageWorker: WorkProcess | undefined;
  const edited = await sharp({
    create: { width: 12, height: 12, channels: 4, background: "#ffdd22" },
  })
    .png()
    .toBuffer();
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const provider = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({
      url: req.url ?? "",
      body: JSON.parse(Buffer.concat(chunks).toString()),
    });
    res.end(
      JSON.stringify({ data: [{ b64_json: edited.toString("base64") }] }),
    );
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const address = provider.address();
  if (!address || typeof address === "string") throw new Error("provider");
  let invoke!: Parameters<Computers["process"]>[2];
  const computers = {
    preflight: async () => {},
    computerId: async () => "local",
    binding: async () => ({
      directory: null,
      computer: { id: "local", authorized: true },
    }),
    transfer: async <T>(_id: number, action: () => Promise<T>) => action(),
    workspace: (id: number) => files.workspace(id),
    process: async (_id: number, _tools: unknown, call: typeof invoke) => {
      invoke = call;
      return worker;
    },
    mcp: async (_id: string, args: Record<string, unknown>) =>
      imageWorker?.mcp(args),
    tools: { catalog: async () => [], finish: () => {} },
  } as unknown as Computers;
  const execution = new EngineExecution(computers, files);
  const registry = createRegistry();
  let services!: ImageServices;
  let bots!: import("../src/bots.ts").Bots;
  registry.install(files.extension());
  registry.install(
    imageExtension(
      () => services,
      () => bots,
    ),
  );
  registry.install(interactionExtension(execution));
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
  bots = runtime.bots;
  onTestFinished(async () => {
    provider.closeAllConnections();
    provider.close();
    await runtime.harness.close(context);
    await worker.close();
    await imageWorker?.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  });
  const id = runtime.conversation.id;
  const workspace = await files.workspace(id);
  await mkdir(workspace.cwd, { recursive: true });
  imageWorker = new WorkProcess(
    [
      process.execPath,
      fileURLToPath(new URL("../src/harness/worker.mjs", import.meta.url)),
    ],
    { cwd: workspace.cwd, home: directory },
    [],
    async () => ({ content: [] }),
  );
  await imageWorker.ready;
  services = new ImageServices(runtime.harness, computers, files, {
    read: async () => ({ type: "api_key", key: "test-only" }),
    list: async () => [],
    delete: async () => {},
    modify: async () => undefined,
  } as CredentialStore);
  await services.save(
    id,
    {
      ...(await services.state(id, context)),
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
    },
    context,
  );
  execution.computer = new ComputerRuntime(
    runtime.harness,
    registry,
    computers,
    files,
  );
  const engines = new Engines(runtime.harness, execution);
  await engines.configure(
    id,
    {
      config: { provider: "codex", model: null },
      revision: 0,
      requestId: crypto.randomUUID(),
    },
    context,
  );
  const original = await sharp({
    create: { width: 12, height: 12, channels: 4, background: "#442200" },
  })
    .png()
    .toBuffer();
  const upload = await files.upload(id, "hair.png", original, context);
  let failure: unknown;
  let generatedId: string | undefined;
  worker.receive = (request) => {
    if (request.method === "thread/start")
      worker.response(request, { thread: { id: "native" } });
    else if (request.method === "turn/start") {
      worker.response(request, { turn: { id: "turn" } });
      void (async () => {
        const input = request.params?.input as {
          type: string;
          text?: string;
        }[];
        const text = input
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
        const line = text
          .split("\n")
          .find((line) => line.startsWith("Uploaded file references"));
        if (!line) throw new Error("Missing uploaded references");
        const references = JSON.parse(line.slice(line.indexOf(": ") + 2));
        const fileId = references[0].fileId;
        expect(fileId).toBe(upload.id);
        expect(references[0].ownerBotId).toBe(id);
        const result = await invoke(
          "edit",
          "image_generate",
          {
            prompt: "Change only the hair to blonde",
            referenceFiles: [fileId],
          },
          new AbortController().signal,
        );
        const outputs = JSON.parse(
          (result.content[0] as { text: string }).text,
        );
        generatedId = outputs[0].fileId;
        expect(generatedId).not.toBe(fileId);
        const delivered = await invoke(
          "deliver",
          "attach_file",
          { id: generatedId },
          new AbortController().signal,
        );
        const receipt = JSON.parse(
          (delivered.content[0] as { text: string }).text,
        );
        expect(receipt.file.fileId).toBe(generatedId);
        expect(receipt.status).toBe("delivered");
        const question = await invoke(
          "compare",
          "ask_question",
          {
            title: "Which hair colour?",
            questions: [
              {
                id: "colour",
                title: "Choose",
                options: [
                  {
                    id: "blonde",
                    label: "Blonde",
                    attachments: [receipt.file.fileId],
                  },
                ],
              },
            ],
          },
          new AbortController().signal,
        );
        expect(question.isError).not.toBe(true);
      })()
        .catch((error) => {
          failure = error;
        })
        .finally(() =>
          worker.frame({
            method: "turn/completed",
            params: { turn: { status: "completed" } },
          }),
        );
    } else if (request.id !== undefined) worker.response(request, {});
  };
  const submission = await engines.submit(
    id,
    {
      text: "Change my hair to blonde",
      requestId: crypto.randomUUID(),
      attachments: [upload],
    },
    context,
  );
  await submission.wait(context);
  expect(failure).toBeUndefined();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    url: "/v1/images/edits",
    body: {
      images: [
        { image_url: `data:image/png;base64,${original.toString("base64")}` },
      ],
    },
  });
  if (!generatedId) throw new Error("Missing output file ID");
  expect(
    Buffer.from(await (await files.download(id, generatedId)).arrayBuffer()),
  ).toEqual(edited);
  expect((await bots.profile(id, context)).avatarMedia).toBeUndefined();
});

test("a durable chat submission reads the stored image and sends its bytes to the engine", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-image-turn-"));
  const database = join(directory, "agent.sqlite");
  const files = new Files(database);
  const worker = new ProtocolProcess();
  const computers = {
    preflight: async () => {},
    computerId: async () => "local",
    binding: async () => ({ directory: null }),
    process: async () => worker,
    tools: { catalog: async () => [], finish: () => {} },
  } as unknown as Computers;
  const execution = new EngineExecution(computers, files);
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
  execution.computer = new ComputerRuntime(
    runtime.harness,
    registry,
    execution.computers,
    runtime.files,
  );
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

test.each([false, true])("screenshot delivery: %s", async (deliver) => {
  const directory = await mkdtemp(join(tmpdir(), "domos-evidence-"));
  const database = join(directory, "agent.sqlite");
  const files = new Files(database);
  const worker = new ProtocolProcess();
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  );
  let returned: unknown;
  let observations = 0;
  const execution = new EngineExecution(
    {
      preflight: async () => {},
      computerId: async () => "local",
      binding: async () => ({ directory: null }),
      process: async (
        _bot: number,
        _tools: unknown,
        invoke: Parameters<Computers["process"]>[2],
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
            ).then(async (result) => {
              returned = result;
              expect(
                await invoke(
                  "capture",
                  "browser_observe",
                  {},
                  new AbortController().signal,
                ),
              ).toMatchObject({
                content: result.content,
                structuredContent: result.structuredContent,
              });
              await expect(
                invoke(
                  "capture",
                  "browser_observe",
                  { scope: "all" },
                  new AbortController().signal,
                ),
              ).rejects.toThrow("标识重复");
              await expect(
                invoke(
                  "invalid",
                  "browser_observe",
                  { scope: 1 },
                  new AbortController().signal,
                ),
              ).rejects.toThrow();
              await expect(
                invoke(
                  "uncertain",
                  "browser_observe",
                  { scope: "fail" },
                  new AbortController().signal,
                ),
              ).rejects.toThrow("Interrupted");
              await expect(
                invoke(
                  "uncertain",
                  "browser_observe",
                  { scope: "fail" },
                  new AbortController().signal,
                ),
              ).rejects.toThrow("结果未知");
              if (deliver) {
                const evidence = result.structuredContent?.evidence;
                expect(Array.isArray(evidence)).toBe(true);
                const file = (evidence as Attachment[])[0];
                await invoke(
                  "deliver",
                  "attach_file",
                  { id: file?.id },
                  new AbortController().signal,
                );
              }
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
            inputSchema: {
              type: "object",
              properties: { scope: { type: "string" } },
            },
          },
        ],
        invoke: async (
          _bot: number,
          _name: string,
          args: { scope?: string },
        ) => {
          observations++;
          if (args.scope === "fail") throw new Error("Interrupted");
          return {
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
          };
        },
        finish: () => {},
      },
    } as unknown as Computers,
    files,
  );
  const registry = createRegistry();
  registry.install(files.extension());
  registry.install(
    defineExtension({
      name: "domos-engines",
      tasks: [engineTask(execution)],
    }),
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
  execution.computer = new ComputerRuntime(
    runtime.harness,
    registry,
    execution.computers,
    runtime.files,
  );
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
  expect(observations).toBe(2);
  try {
    const file = (returned as { structuredContent: { evidence: Attachment[] } })
      .structuredContent.evidence[0];
    expect(
      chatView(state.value).messages.flatMap(
        (message) => message.attachments ?? [],
      ),
    ).toEqual(deliver ? [file] : []);
    expect(file?.source).toMatchObject({
      url: "https://example.org/report",
      capturedAt: "2026-10-19T12:00:00.000Z",
      tool: "browser_observe",
      callId: "capture",
    });
    if (!file) throw new Error("Evidence required");
    const note = (
      returned as { content: { type: string; text?: string }[] }
    ).content.find((part) =>
      part.text?.startsWith("Screenshots saved as task evidence."),
    );
    expect(JSON.parse(note?.text?.split("\n").at(-1) ?? "null")).toEqual([
      { id: file.id, name: file.name },
    ]);
    expect(
      Buffer.from(await (await files.download(botId, file.id)).arrayBuffer()),
    ).toEqual(bytes);
    expect(returned).toMatchObject({
      content: expect.arrayContaining([
        {
          type: "image",
          mimeType: "image/png",
          data: bytes.toString("base64"),
        },
        { type: "text", text: expect.stringContaining(file.id) },
      ]),
      structuredContent: { evidence: [{ id: file.id }] },
    });
  } finally {
    state.dispose();
  }
});
