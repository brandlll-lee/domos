import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai/providers/faux";
import {
  AgentDoc,
  createRegistry,
  defineDoc,
  defineExtension,
  defineTask,
  type TaskId,
} from "@earendil-works/pi-durable";
import { expect, onTestFinished, test } from "vitest";
import { chatView } from "../src/chat-view.ts";
import type { Computers } from "../src/computer/catalog.ts";
import { ComputerRuntime } from "../src/computer/runtime.ts";
import { EngineDoc, EngineInputDoc } from "../src/harness/state.ts";
import type { EngineTaskInput } from "../src/harness/task-types.ts";
import { messageText } from "../src/messages.ts";
import { openAgent } from "../src/open-agent.ts";
import {
  EngineExecution,
  Runtime as Engines,
  engineTask,
} from "../src/runtime/index.ts";
import { migrateRuntime } from "../src/runtime/migrate.ts";
import { MemoryDoc } from "../src/work/memory.ts";
import { ProtocolProcess } from "./fixtures/engine-process.ts";
import { codexWork } from "./fixtures/native-work.ts";

test("forward migration preserves model, history and drafts and runs once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-native-migration-"));
  const models = createModels();
  models.setProvider(fauxProvider().provider);
  const runtime = await openAgent(
    join(directory, "agent.sqlite"),
    { registry: createRegistry(), models },
    {},
    context,
  );
  onTestFinished(async () => {
    await runtime.harness.close(context);
    await rm(directory, { recursive: true, force: true });
  });
  const marker = defineDoc<{ complete: boolean }>({
    kind: "domos.native-runtime",
    version: 1,
    checkpointWhen: () => false,
    scope: "conversation",
    history: "latest",
    fork: "initial",
    initial: () => ({ complete: false }),
  });
  const id = runtime.conversation.id;
  await runtime.harness.commit(async (tx) => {
    (await tx.doc(marker, id)).complete = false;
    const agent = await tx.doc(AgentDoc, id);
    agent.model = { provider: "example", modelId: "kept-model" };
    agent.thinkingLevel = "high";
    await tx.appendEntry(id, {
      kind: "domos.engine-message",
      data: {
        id: "old-message",
        role: "user",
        content: [{ type: "text", text: "Keep history" }],
        timestamp: 1,
      },
    });
    const doc = await tx.doc(EngineDoc, id);
    doc.sessionId = "previous-session";
    doc.drafts = [
      {
        id: "draft",
        role: "assistant",
        content: [{ type: "text", text: "Keep draft", key: "draft" }],
        timestamp: 2,
        pending: true,
        stopped: false,
      },
    ];
  }, context);
  await migrateRuntime(runtime.harness, id, context);
  const migrated = await runtime.harness.snapshot(EngineDoc, id, context);
  expect(migrated).toMatchObject({
    config: {
      provider: "pi",
      model: "example/kept-model",
      options: { thinkingLevel: "high" },
    },
    sessionId: null,
    prepared: false,
    drafts: [],
  });
  const entries = await runtime.conversation.entries(
    {},
    100,
    undefined,
    context,
  );
  expect(JSON.stringify(entries.items)).toContain("Keep history");
  expect(JSON.stringify(entries.items)).toContain("Keep draft");
  await runtime.harness.commit(async (tx) => {
    (await tx.doc(EngineDoc, id)).config = {
      provider: "codex",
      model: "new-model",
    };
  }, context);
  await migrateRuntime(runtime.harness, id, context);
  expect(
    (await runtime.harness.snapshot(EngineDoc, id, context))?.config,
  ).toEqual({ provider: "codex", model: "new-model" });
  expect(
    (await runtime.conversation.entries({}, 100, undefined, context)).items,
  ).toHaveLength(entries.items.length);
});

test.each(["completed", "running", "sending"] as const)(
  "restart reconciles %s work without sending it again",
  async (outcome) => {
    const directory = await mkdtemp(join(tmpdir(), "domos-reconcile-"));
    const database = join(directory, "agent.sqlite");
    const requestId = crypto.randomUUID();
    const extraRequestId = crypto.randomUUID();
    const workers: ProtocolProcess[] = [];
    const computers = {
      preflight: async () => {},
      computerId: async () => "shared",
      process: async () => {
        const worker = new ProtocolProcess();
        workers.push(worker);
        worker.receive = (request) => {
          if (
            request.method === "thread/start" ||
            request.method === "thread/resume"
          )
            worker.response(request, { thread: { id: "native-thread" } });
          else if (request.method === "turn/start") {
            if (outcome !== "sending")
              worker.response(request, { turn: { id: "native-turn" } });
          } else if (request.method === "thread/turns/list")
            worker.response(request, {
              data: [{ id: "native-turn", status: outcome }],
              nextCursor: null,
            });
          else if (request.method === "thread/items/list")
            worker.response(request, {
              data: [
                ...codexWork
                  .filter((item) => item.type !== "agentMessage")
                  .map((item) => ({ item })),
                {
                  item: {
                    id: "answer",
                    type: "agentMessage",
                    text: "Recovered result",
                  },
                },
              ],
              nextCursor: null,
            });
          else if (request.id !== undefined) worker.response(request, {});
        };
        return worker;
      },
      tools: { catalog: async () => [], finish: () => {} },
    } as unknown as Computers;
    async function open() {
      const models = createModels();
      models.setProvider(fauxProvider().provider);
      const registry = createRegistry();
      const execution = new EngineExecution(computers);
      registry.install(
        defineExtension({
          name: "domos-engines",
          tasks: [engineTask(execution)],
        }),
      );
      const runtime = await openAgent(
        database,
        { registry, models },
        {},
        context,
      );
      execution.computer = new ComputerRuntime(
        runtime.harness,
        registry,
        execution.computers,
        runtime.files,
      );
      return { ...runtime, engines: new Engines(runtime.harness, execution) };
    }
    let runtime = await open();
    onTestFinished(async () => {
      await runtime.harness.close(context);
      await Promise.all(workers.map((worker) => worker.close()));
      await rm(directory, { recursive: true, force: true });
    });
    const id = runtime.conversation.id;
    await runtime.engines.configure(
      id,
      {
        config: { provider: "codex", model: null },
        revision: 0,
        requestId: crypto.randomUUID(),
      },
      context,
    );
    await runtime.harness.commit(async (tx) => {
      (await tx.doc(MemoryDoc)).items.push({
        id: "profile",
        botId: id,
        category: "profile",
        text: "Original profile fact",
        revision: 1,
        updatedAt: 1,
        source: "user",
        requestId: "profile-1",
      });
    }, context);
    await runtime.engines.submit(id, { text: "Save once", requestId }, context);
    await expect
      .poll(
        async () =>
          (await runtime.harness.snapshot(EngineDoc, id, context))?.dispatch,
      )
      .toBe(outcome === "sending" ? "sending" : "accepted");
    if (outcome !== "sending") {
      await runtime.engines.submit(
        id,
        { text: "Include this too", requestId: extraRequestId },
        context,
      );
      await expect
        .poll(
          () =>
            workers
              .flatMap((worker) => worker.requests)
              .filter((request) => request.method === "turn/steer").length,
        )
        .toBe(1);
    }
    await runtime.harness.commit(async (tx) => {
      const memory = (await tx.doc(MemoryDoc)).items[0];
      if (memory) memory.text = "Updated profile fact";
    }, context);
    await runtime.harness.close(context);
    runtime = await open();
    const submission = await runtime.engines.submit(
      id,
      { text: "Save once", requestId },
      context,
    );
    expect(await submission.wait(context)).toMatchObject({
      status: outcome === "completed" ? "done" : "unanswered",
    });
    const instructions = JSON.stringify(
      workers
        .at(-1)
        ?.requests.find((request) => request.method === "thread/resume")
        ?.params,
    );
    expect(instructions).toContain("Original profile fact");
    expect(instructions).not.toContain("Updated profile fact");
    if (outcome !== "sending") {
      const extra = await runtime.engines.submit(
        id,
        { text: "Include this too", requestId: extraRequestId },
        context,
      );
      expect(await extra.wait(context)).toMatchObject({
        status: outcome === "completed" ? "done" : "unanswered",
      });
      expect(
        workers
          .flatMap((worker) => worker.requests)
          .filter((request) => request.method === "turn/steer"),
      ).toHaveLength(1);
    }
    expect(
      workers
        .flatMap((worker) => worker.requests)
        .filter((request) => request.method === "turn/start"),
    ).toHaveLength(1);
    const state = await runtime.conversation.viewState(context);
    try {
      if (outcome === "completed") {
        const records = chatView(state.value).messages;
        expect(
          records
            .filter((message) => message.role === "toolResult")
            .map((message) => message.toolCallId),
        ).toEqual(["search", "command", "files", "child"]);
        expect(
          records.find((message) => message.toolCallId === "search")?.native
            ?.action,
        ).toEqual(codexWork[0]?.action);
        expect(chatView(state.value).messages.map(messageText)).toContain(
          "Recovered result",
        );
      } else
        expect((await runtime.engines.view(id, context)).error).toContain(
          "执行结果未确认",
        );
    } finally {
      state.dispose();
    }
  },
);

test("switching from embedded Pi imports recent conversation into the first native session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-engine-history-"));
  const faux = fauxProvider();
  faux.setResponses([fauxAssistantMessage("Remember the blue folder")]);
  const models = createModels();
  models.setProvider(faux.provider);
  const workers: ProtocolProcess[] = [];
  let prompt = "";
  let computerId = "shared";
  const execution = new EngineExecution({
    preflight: async () => {},
    computerId: async () => computerId,
    process: async () => {
      const worker = new ProtocolProcess();
      workers.push(worker);
      worker.receive = (request) => {
        if (request.type) {
          worker.frame({
            type: "response",
            id: request.id,
            success: true,
            data:
              request.type === "get_state"
                ? { sessionFile: "/pi/session" }
                : {},
          });
          if (request.type === "prompt") {
            worker.frame({
              type: "message_end",
              message: {
                role: "assistant",
                stopReason: "stop",
                content: [
                  { type: "text", text: "Pi completed the blue folder task" },
                ],
              },
            });
            worker.frame({ type: "agent_settled" });
          }
        } else if (
          request.method === "thread/start" ||
          request.method === "thread/resume"
        )
          worker.response(request, { thread: { id: "native" } });
        else if (request.method === "turn/start") {
          prompt = JSON.stringify(request.params?.input);
          worker.response(request, { turn: { id: "turn" } });
          worker.frame({
            method: "turn/completed",
            params: { turn: { status: "completed" } },
          });
        } else if (request.id !== undefined) worker.response(request, {});
      };
      return worker;
    },
    tools: { catalog: async () => [], finish: () => {} },
  } as unknown as Computers);
  const registry = createRegistry();
  registry.install(
    defineExtension({ name: "domos-engines", tasks: [engineTask(execution)] }),
  );
  const runtime = await openAgent(
    join(directory, "agent.sqlite"),
    { registry, models },
    { model: { provider: "faux", modelId: "faux-1" } },
    context,
  );
  onTestFinished(async () => {
    await runtime.harness.close(context);
    await Promise.all(workers.map((worker) => worker.close()));
    await rm(directory, { recursive: true, force: true });
  });
  await (
    await runtime.conversation.submit(
      {
        type: "input",
        content: "Folder choice",
        requestId: crypto.randomUUID(),
      },
      context,
    )
  ).wait(context);
  execution.computer = new ComputerRuntime(
    runtime.harness,
    registry,
    execution.computers,
    runtime.files,
  );
  const engines = new Engines(runtime.harness, execution);
  await engines.configure(
    runtime.conversation.id,
    {
      config: { provider: "codex", model: null },
      revision: 0,
      requestId: crypto.randomUUID(),
    },
    context,
  );
  await (
    await engines.submit(
      runtime.conversation.id,
      { text: "Use that folder", requestId: crypto.randomUUID() },
      context,
    )
  ).wait(context);
  expect(prompt).toContain("Remember the blue folder");
  expect(prompt).toContain("Current request");
  const change = async (
    provider: "pi" | "codex",
    model: string | null = null,
  ) => {
    const profile = await engines.profile(runtime.conversation.id, context);
    await engines.configure(
      runtime.conversation.id,
      {
        config: { provider, model },
        revision: profile.revision,
        requestId: crypto.randomUUID(),
      },
      context,
    );
    await (
      await engines.submit(
        runtime.conversation.id,
        { text: "Continue", requestId: crypto.randomUUID() },
        context,
      )
    ).wait(context);
  };
  await change("codex");
  await change("codex", "second-model");
  expect(
    workers
      .at(-1)
      ?.requests.find((request) => request.method === "thread/resume")?.params,
  ).toMatchObject({ threadId: "native", excludeTurns: true });
  await change("pi");
  await change("codex", "second-model");
  expect(
    workers
      .at(-1)
      ?.requests.some((request) => request.method === "thread/start"),
  ).toBe(true);
  expect(prompt).toContain("Pi completed the blue folder task");
  expect(prompt).toContain("Remember the blue folder");
  computerId = "remote";
  await change("codex", "second-model");
  expect(
    workers
      .at(-1)
      ?.requests.some((request) => request.method === "thread/start"),
  ).toBe(true);
  const state = await runtime.conversation.viewState(context);
  expect(chatView(state.value).messages.map(messageText)).toContain(
    "Remember the blue folder",
  );
  state.dispose();
});

test.each(["tools", "ack", "gap"])(
  "failed Pi handoff retains confirmed range: %s",
  async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), "domos-pi-receipt-"));
    const workers: ProtocolProcess[] = [];
    const prompts: string[] = [];
    let runtime: Awaited<ReturnType<typeof openAgent>>;
    const execution = new EngineExecution({
      preflight: async () => {},
      computerId: async () => "shared",
      tools: { catalog: async () => [], finish: () => {} },
      process: async () => {
        const worker = new ProtocolProcess();
        workers.push(worker);
        worker.receive = (request) => {
          worker.frame({
            type: "response",
            id: request.id,
            success: true,
            data:
              request.type === "get_state"
                ? { sessionFile: "/pi/session" }
                : {},
          });
          if (request.type !== "prompt") return;
          prompts.push(String(request.message ?? ""));
          void (async () => {
            if (prompts.length === 1) {
              if (mode === "gap")
                await runtime.harness.commit(async (tx) => {
                  await tx.appendEntry(runtime.conversation.id, {
                    kind: "domos.engine-message",
                    data: {
                      id: "extra",
                      role: "user",
                      content: [
                        { type: "text", text: "Unconfirmed extra input" },
                      ],
                    },
                  });
                }, context);
              if (mode !== "ack") {
                worker.frame({
                  type: "tool_execution_start",
                  toolCallId: "observe",
                  toolName: "desktop_observe",
                  args: {},
                });
                worker.frame({
                  type: "tool_execution_end",
                  toolCallId: "observe",
                  toolName: "desktop_observe",
                  result: {
                    content: [
                      { type: "text", text: "Native observation receipt" },
                    ],
                  },
                });
              }
              worker.frame({
                type: "message_end",
                message: {
                  role: "assistant",
                  stopReason: "error",
                  errorMessage: "402 Insufficient Balance",
                },
              });
            } else
              worker.frame({
                type: "message_end",
                message: {
                  role: "assistant",
                  stopReason: "stop",
                  content: [{ type: "text", text: "Done" }],
                },
              });
            worker.frame({ type: "agent_settled" });
          })();
        };
        return worker;
      },
    } as unknown as Computers);
    const registry = createRegistry();
    registry.install(
      defineExtension({
        name: "domos-engines",
        tasks: [engineTask(execution)],
      }),
    );
    runtime = await openAgent(
      join(directory, "agent.sqlite"),
      { registry, models: createModels() },
      {},
      context,
    );
    onTestFinished(async () => {
      await runtime.harness.close(context);
      await Promise.all(workers.map((worker) => worker.close()));
      await rm(directory, { recursive: true, force: true });
    });
    execution.computer = new ComputerRuntime(
      runtime.harness,
      registry,
      execution.computers,
      runtime.files,
    );
    const engines = new Engines(runtime.harness, execution);
    const bot = runtime.conversation.id;
    const first = await engines.submit(
      bot,
      { text: "Play music", requestId: crypto.randomUUID() },
      context,
    );
    expect(await first.wait(context)).toMatchObject({ status: "unanswered" });
    expect((await engines.view(bot, context)).error).toContain("402");
    await (
      await engines.submit(
        bot,
        { text: "Continue", requestId: crypto.randomUUID() },
        context,
      )
    ).wait(context);
    expect(prompts[1]).toContain("402 Insufficient Balance");
    if (mode === "tools")
      expect(prompts[1]).not.toContain("Native observation receipt");
    if (mode === "gap") {
      expect(prompts[1]).toContain("Unconfirmed extra input");
      expect(prompts[1]).not.toContain("Native observation receipt");
    }
  },
);

test.each(["view", "stop", "reopen", "queued"])(
  "%s reconciles a terminal task and preserves its replies",
  async (action) => {
    const directory = await mkdtemp(join(tmpdir(), "domos-terminal-"));
    const database = join(directory, "agent.sqlite");
    const models = createModels();
    models.setProvider(fauxProvider().provider);
    const gate = Promise.withResolvers<void>();
    let executions = 0;
    const failed = defineTask<EngineTaskInput, { phase: "run" }, null, object>({
      name: "fixture.failure",
      version: 1,
      initial: () => ({ phase: "run" }),
      phases: {
        async run() {
          await gate.promise;
          throw new Error("Fixture failure");
        },
      },
      async abort() {
        throw new Error("Fixture failure");
      },
    });
    const computers = {
      initialize: async () => {},
      preflight: async () => {},
      process: async () => {
        executions++;
        throw new Error("Unexpected execution");
      },
      computerId: async () => "local",
      tools: { catalog: async () => [], finish: () => {} },
    } as unknown as Computers;
    const open = async () => {
      const registry = createRegistry();
      registry.install(defineExtension({ name: "fixture", tasks: [failed] }));
      const runtime = await openAgent(
        database,
        { registry, models, computers },
        {},
        context,
      );
      if (!runtime.engines) throw new Error("Engines are required");
      return { ...runtime, engines: runtime.engines };
    };
    let runtime = await open();
    onTestFinished(async () => {
      await runtime.harness.close(context);
      await rm(directory, { recursive: true, force: true });
    });
    const botId = runtime.conversation.id;
    const { taskId, submissionId } = await runtime.harness.commit(
      async (tx) => {
        const submission = await tx.createSubmission({
          type: "input",
          conversationId: botId,
          requestId: crypto.randomUUID(),
          status: "queued",
        });
        const taskId = await tx.createTask(
          failed,
          {
            text: "first",
            turnId: "first",
            submissionId: submission.id,
            previous: null,
          },
          {
            ownership: { kind: "conversation" },
            conversationId: botId,
            background: true,
          },
        );
        (await tx.doc(EngineInputDoc, taskId)).status = "accepted";

        const doc = await tx.doc(EngineDoc, botId);
        doc.tasks = [taskId];
        doc.taskId = taskId;
        doc.activeId = taskId;
        doc.activeTurn = "first";
        doc.drafts = [
          {
            id: "answer",
            turnId: "first",
            role: "assistant",
            content: [{ type: "text", text: "Preserved reply", key: "answer" }],
            pending: false,
            stopped: false,
            timestamp: 1,
          },
        ];
        return { taskId, submissionId: submission.id };
      },
      context,
    );
    let additional: Awaited<ReturnType<Engines["submit"]>> | undefined;
    let additionalTask: TaskId | null = null;
    if (action === "queued") {
      additional = await runtime.engines.submit(
        botId,
        { text: "Already received", requestId: crypto.randomUUID() },
        context,
      );
      await runtime.harness.commit(async (tx) => {
        const doc = await tx.doc(EngineDoc, botId);
        if (!doc.taskId) throw new Error("Task is required");
        additionalTask = doc.taskId;
        const input = await tx.doc(EngineInputDoc, doc.taskId);
        input.owner = taskId;
        input.status = "accepted";
      }, context);
    }
    gate.resolve();
    await runtime.harness.waitForTask(taskId, context);
    if (additional)
      expect(await additional.wait(context)).toMatchObject({
        status: "unanswered",
      });
    if (additionalTask)
      await runtime.harness.waitForTask(additionalTask, context);
    expect(executions).toBe(0);
    if (action === "stop") await runtime.engines.stop(botId, context);
    if (action === "reopen") {
      await runtime.harness.close(context);
      runtime = await open();
    }
    const view = await runtime.engines.view(botId, context);
    expect(view.busy).toBe(false);
    expect(view.messages.map(messageText)).toContain("Preserved reply");
    expect(view.error).toContain("Fixture failure");
    const submission = await runtime.harness.submission(submissionId, context);
    expect(await submission?.wait(context)).toMatchObject({
      status: "unanswered",
    });
    expect(
      (await runtime.bots.list(context)).find((bot) => bot.id === botId)?.busy,
    ).toBe(false);
    expect(
      (await runtime.engines.view(botId, context)).messages.filter(
        (message) => message.id === "answer",
      ),
    ).toHaveLength(1);
  },
);
