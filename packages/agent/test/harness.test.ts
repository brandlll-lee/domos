import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, defineExtension } from "@earendil-works/pi-durable";
import { expect, onTestFinished, test } from "vitest";
import { chatView } from "../src/chat-view.ts";
import type { Computers } from "../src/computer/catalog.ts";
import { EngineExecution, Engines, engineTask } from "../src/harness/index.ts";
import { callProductTool } from "../src/harness/product-tools.ts";
import { EngineDoc } from "../src/harness/state.ts";
import type { EngineRuntime } from "../src/harness/task-types.ts";
import type { EngineEvent } from "../src/harness/types.ts";
import { engineIds } from "../src/harness/types.ts";
import { messageText } from "../src/messages.ts";
import { openAgent } from "../src/open-agent.ts";
import { chatTranscript } from "../src/transcript.ts";

test("native turns share product tools, queue in order and keep separate sessions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-turns-"));
  const registry = createRegistry();
  const models = createModels();
  models.setProvider(fauxProvider().provider);
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let count = 0;
  class Execution extends EngineExecution {
    override async run(
      runtime: EngineRuntime,
      text: string,
      _context: typeof context,
      emit: (event: EngineEvent) => Promise<void>,
    ) {
      count++;
      await emit({ type: "session", id: `session-${runtime.conversationId}` });
      await emit({ type: "accepted", id: `turn-${count}` });
      if (text === "first") {
        started.resolve();
        await release.promise;
      }
      const args = { text: `Keep ${text}`, shared: false, revision: 0 };
      const a = await callProductTool(
        runtime,
        "save",
        "memory_save",
        args,
        context,
      );
      const b = await callProductTool(
        runtime,
        "save",
        "memory_save",
        args,
        context,
      );
      expect(a).toEqual(b);
      await emit({ type: "text", id: "answer", text: `Done ${text}` });
    }
  }
  const execution = new Execution({
    preflight: async () => {},
    computerId: async () => "shared",
  } as unknown as Computers);
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
    release.resolve();
    await runtime.harness.close(context);
    await rm(directory, { recursive: true, force: true });
  });
  const engines = new Engines(runtime.harness, execution);
  const botId = runtime.conversation.id;
  const requestId = crypto.randomUUID();
  const first = await engines.submit(
    botId,
    { text: "first", requestId },
    context,
  );
  await started.promise;
  expect(
    (await engines.submit(botId, { text: "first", requestId }, context)).id,
  ).toBe(first.id);
  await expect(
    engines.configure(
      botId,
      {
        config: { provider: "codex", model: null },
        revision: 0,
        requestId: crypto.randomUUID(),
      },
      context,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const second = await engines.submit(
    botId,
    { text: "second", requestId: crypto.randomUUID(), whenBusy: "followUp" },
    context,
  );
  release.resolve();
  expect(await first.wait(context)).toMatchObject({ status: "done" });
  expect(await second.wait(context)).toMatchObject({ status: "done" });
  expect(count).toBe(2);
  expect(await runtime.work.memory.list(botId, context)).toHaveLength(2);
  expect(
    (await runtime.harness.snapshot(EngineDoc, botId, context))?.tasks,
  ).toEqual([]);
  const state = await runtime.conversation.viewState(context);
  try {
    expect(
      chatView(state.value)
        .messages.filter((message) => message.role === "assistant")
        .map(messageText),
    ).toEqual(["Done first", "Done second"]);
  } finally {
    state.dispose();
  }
});

test.each(engineIds)(
  "%s keeps failed drafts in the process after later successful work",
  async (provider) => {
    const directory = await mkdtemp(join(tmpdir(), "domos-delivery-turns-"));
    const registry = createRegistry();
    const models = createModels();
    models.setProvider(fauxProvider().provider);
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    class Execution extends EngineExecution {
      override async run(
        _runtime: EngineRuntime,
        text: string,
        _context: typeof context,
        emit: (event: EngineEvent) => Promise<void>,
      ) {
        if (text === "fail") {
          await emit({ type: "text", id: "answer", text: "Unfinished draft" });
          await emit({
            type: "approval",
            approval: {
              id: "approval",
              kind: "question",
              title: "Choose a folder",
              detail: "Which folder?",
            },
          });
          started.resolve();
          await release.promise;
          throw new Error("Connection lost");
        }
        await emit({ type: "text", id: "answer", text: "Complete result" });
      }
    }
    const execution = new Execution({
      preflight: async () => {},
      computerId: async () => "shared",
    } as unknown as Computers);
    registry.install(
      defineExtension({
        name: "domos-engines",
        tasks: [engineTask(execution)],
      }),
    );
    const runtime = await openAgent(
      join(directory, "agent.sqlite"),
      { registry, models },
      { model: { provider: "faux", modelId: "faux-1" } },
      context,
    );
    onTestFinished(async () => {
      release.resolve();
      await runtime.harness.close(context);
      await rm(directory, { recursive: true, force: true });
    });
    const engines = new Engines(runtime.harness, execution);
    const botId = runtime.conversation.id;
    await runtime.harness.commit(async (tx) => {
      (await tx.doc(EngineDoc, botId)).config = { provider, model: null };
    }, context);
    const failed = await engines.submit(
      botId,
      { text: "fail", requestId: crypto.randomUUID() },
      context,
    );
    await started.promise;
    const working = await engines.view(botId, context);
    expect(working.approvals).toMatchObject([
      { kind: "question", title: "Choose a folder" },
    ]);
    expect(
      chatTranscript(working).filter((item) => item.kind === "message"),
    ).toHaveLength(1);
    release.resolve();
    expect(await failed.wait(context)).toMatchObject({ status: "unanswered" });
    const complete = await engines.submit(
      botId,
      { text: "complete", requestId: crypto.randomUUID() },
      context,
    );
    await complete.wait(context);
    const items = chatTranscript(await engines.view(botId, context));
    expect(items.find((item) => item.kind === "activity")).toMatchObject({
      status: "failed",
      error: "Connection lost",
      steps: [{ text: "Unfinished draft" }],
    });
    expect(
      items.filter(
        (item) => item.kind === "message" && item.message.role === "assistant",
      ),
    ).toMatchObject([{ message: { content: [{ text: "Complete result" }] } }]);
  },
);
