import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, defineExtension } from "@earendil-works/pi-durable";
import { expect, onTestFinished, test } from "vitest";
import { chatView } from "../src/chat-view.ts";
import type { Computers } from "../src/computer/catalog.ts";
import { EngineExecution, Engines, engineTask } from "../src/harness/index.ts";
import { EngineDoc } from "../src/harness/state.ts";
import { messageText } from "../src/messages.ts";
import { openAgent } from "../src/open-agent.ts";
import { ProtocolProcess } from "./fixtures/engine-process.ts";

test.each(["completed", "running", "sending"] as const)(
  "restart reconciles %s work without sending it again",
  async (outcome) => {
    const directory = await mkdtemp(join(tmpdir(), "domos-reconcile-"));
    const database = join(directory, "agent.sqlite");
    const requestId = crypto.randomUUID();
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
          } else if (request.method === "thread/read")
            worker.response(request, {
              thread: {
                turns: [
                  {
                    id: "native-turn",
                    status: outcome,
                    items: [
                      {
                        id: "answer",
                        type: "agentMessage",
                        text: "Recovered result",
                      },
                    ],
                  },
                ],
              },
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
    await runtime.engines.submit(id, { text: "Save once", requestId }, context);
    await expect
      .poll(
        async () =>
          (await runtime.harness.snapshot(EngineDoc, id, context))?.dispatch,
      )
      .toBe(outcome === "sending" ? "sending" : "accepted");
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
    expect(
      workers
        .flatMap((worker) => worker.requests)
        .filter((request) => request.method === "turn/start"),
    ).toHaveLength(1);
    const state = await runtime.conversation.viewState(context);
    try {
      if (outcome === "completed")
        expect(chatView(state.value).messages.map(messageText)).toContain(
          "Recovered result",
        );
      else
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
  const worker = new ProtocolProcess();
  let prompt = "";
  worker.receive = (request) => {
    if (request.method === "thread/start")
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
  const execution = new EngineExecution({
    preflight: async () => {},
    computerId: async () => "shared",
    process: async () => worker,
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
    await worker.close();
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
  const state = await runtime.conversation.viewState(context);
  expect(chatView(state.value).messages.map(messageText)).toContain(
    "Remember the blue folder",
  );
  state.dispose();
});
