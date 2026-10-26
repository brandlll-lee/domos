import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import {
  createRegistry,
  defineExtension,
  type EntryId,
  type Tx,
} from "@earendil-works/pi-durable";
import { expect, onTestFinished, test, vi } from "vitest";
import type { Computers } from "../src/computer/catalog.ts";
import { handoffBudget } from "../src/harness/budget.ts";
import { conversationHistory } from "../src/harness/history.ts";
import { EngineExecution, Engines, engineTask } from "../src/harness/index.ts";
import { callProductTool } from "../src/harness/product-tools.ts";
import { engineProvider } from "../src/harness/providers/index.ts";
import {
  EngineDoc,
  EngineMessage,
  type EngineState,
} from "../src/harness/state.ts";
import type { EngineRuntime } from "../src/harness/task-types.ts";
import { engineIds } from "../src/harness/types.ts";
import { openAgent } from "../src/open-agent.ts";
import { ProtocolProcess, type Request } from "./fixtures/engine-process.ts";
import cases from "./fixtures/harness-context.json" with { type: "json" };

async function openContext(
  receive: (worker: ProtocolProcess, request: Request) => void,
) {
  const directory = await mkdtemp(join(tmpdir(), "domos-context-"));
  const workers: ProtocolProcess[] = [];
  const catalogs: (readonly unknown[])[] = [];
  const execution = new EngineExecution({
    preflight: async () => {},
    computerId: async () => "shared",
    process: async (_id: number, tools: readonly unknown[]) => {
      catalogs.push(tools);
      const worker = new ProtocolProcess();
      workers.push(worker);
      worker.receive = (request) => receive(worker, request);
      return worker;
    },
    tools: { catalog: async () => [], finish: () => {} },
  } as unknown as Computers);
  const registry = createRegistry();
  registry.install(
    defineExtension({ name: "domos-engines", tasks: [engineTask(execution)] }),
  );
  const models = createModels();
  models.setProvider(fauxProvider().provider);
  let runtime = await openAgent(
    join(directory, "agent.sqlite"),
    { registry, models },
    {},
    context,
  );
  onTestFinished(async () => {
    await runtime.harness.close(context);
    await Promise.all(workers.map((worker) => worker.close()));
    await rm(directory, { recursive: true, force: true });
  });
  const botId = runtime.conversation.id;
  const engines = new Engines(runtime.harness, execution);
  await runtime.harness.commit(async (tx) => {
    (await tx.doc(EngineDoc, botId)).config = {
      provider: "codex",
      model: null,
    };
    await tx.appendEntry(botId, {
      kind: EngineMessage,
      data: {
        id: "earlier",
        role: "user",
        content: [{ type: "text", text: cases.fact, key: "earlier" }],
        stopped: false,
      },
    });
  }, context);
  const reader = {
    conversationId: botId,
    commit: (fn: (tx: Tx, current: { input: object }) => Promise<unknown>) =>
      runtime.harness.commit((tx) => fn(tx, { input: {} }), context),
  } as unknown as EngineRuntime;
  return {
    ...runtime,
    botId,
    engines,
    workers,
    reader,
    catalogs,
    reopen: async () => {
      await runtime.harness.close(context);
      runtime = await openAgent(
        join(directory, "agent.sqlite"),
        { registry, models },
        {},
        context,
      );
      return { ...runtime, engines: new Engines(runtime.harness, execution) };
    },
  };
}

test.each(["rejected", "accepted"])(
  "%s first turn preserves the session's confirmed input progress",
  async (delivery) => {
    const prompts: string[] = [];
    const runtime = await openContext((worker, request) => {
      if (["thread/start", "thread/resume"].includes(request.method ?? ""))
        worker.response(request, { thread: { id: "native" } });
      else if (request.method === "turn/start") {
        prompts.push(JSON.stringify(request.params?.input));
        if (prompts.length === 1 && delivery === "rejected") {
          worker.frame({ id: request.id, error: { code: -32000 } });
          return;
        }
        worker.response(request, { turn: { id: `turn-${prompts.length}` } });
        worker.frame({
          method: "turn/completed",
          params: {
            turn: { status: prompts.length === 1 ? "failed" : "completed" },
          },
        });
      } else if (request.id !== undefined) worker.response(request, {});
    });
    const submit = async (text: string) =>
      (
        await runtime.engines.submit(
          runtime.botId,
          { text, requestId: crypto.randomUUID() },
          context,
        )
      ).wait(context);
    expect(await submit("First request")).toMatchObject({
      status: "unanswered",
    });
    const state = await runtime.harness.snapshot(
      EngineDoc,
      runtime.botId,
      context,
    );
    expect(state?.sessions?.[state.sessionKey ?? ""]?.through === null).toBe(
      delivery === "rejected",
    );
    Object.assign(runtime, await runtime.reopen());
    expect(await submit("Next request")).toMatchObject({ status: "done" });
    expect(prompts[0]).toContain(cases.fact);
    expect(prompts[1]?.includes(cases.fact)).toBe(delivery === "rejected");
    expect(
      runtime.workers[1]?.requests.some((r) => r.method === "thread/resume"),
    ).toBe(true);
  },
);

test("stopping before dispatch keeps the first handoff pending for the next request", async () => {
  const prompts: string[] = [];
  const runtime = await openContext((worker, request) => {
    if (["thread/start", "thread/resume"].includes(request.method ?? ""))
      worker.response(request, { thread: { id: "native" } });
    else if (request.method === "turn/start") {
      prompts.push(JSON.stringify(request.params?.input));
      worker.response(request, { turn: { id: "turn" } });
      worker.frame({
        method: "turn/completed",
        params: { turn: { status: "completed" } },
      });
    } else if (request.id !== undefined) worker.response(request, {});
  });
  const opened = Promise.withResolvers<void>();
  const mock = vi
    .spyOn(engineProvider("codex"), "open")
    .mockImplementationOnce(async (options) => {
      await options.emit({ type: "session", id: "native" });
      opened.resolve();
      await options.process.closed;
      throw new Error("Stopped before dispatch");
    });
  onTestFinished(() => mock.mockRestore());
  const first = await runtime.engines.submit(
    runtime.botId,
    { text: "First", requestId: crypto.randomUUID() },
    context,
  );
  await opened.promise;
  await runtime.engines.stop(runtime.botId, context);
  expect(await first.wait(context)).toMatchObject({ status: "unanswered" });
  const state = await runtime.harness.snapshot(
    EngineDoc,
    runtime.botId,
    context,
  );
  expect(state?.sessions?.[state.sessionKey ?? ""]?.through).toBe(null);
  Object.assign(runtime, await runtime.reopen());
  const next = await runtime.engines.submit(
    runtime.botId,
    { text: "Next", requestId: crypto.randomUUID() },
    context,
  );
  expect(await next.wait(context)).toMatchObject({ status: "done" });
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain(cases.fact);
});

test("Pi checkpoints keep a rejected handoff pending across restart", async () => {
  const prompts: string[] = [];
  const runtime = await openContext((worker, request) => {
    if (request.type === "prompt") {
      prompts.push(JSON.stringify(request.message));
      worker.frame({
        type: "response",
        id: request.id,
        success: prompts.length > 1,
        ...(prompts.length > 1
          ? { data: { disposition: "started" } }
          : { error: "Rejected" }),
      });
      if (prompts.length > 1) worker.frame({ type: "agent_settled" });
      return;
    }
    worker.frame({
      type: "response",
      id: request.id,
      success: true,
      data:
        request.type === "get_state"
          ? { sessionFile: "/native/session" }
          : request.type === "get_session_stats"
            ? { contextUsage: { tokens: 0, contextWindow: 32000 } }
            : {},
    });
  });
  await runtime.harness.commit(async (tx) => {
    (await tx.doc(EngineDoc, runtime.botId)).config = {
      provider: "pi",
      model: null,
    };
  }, context);
  const submit = async () =>
    (
      await runtime.engines.submit(
        runtime.botId,
        { text: "Current", requestId: crypto.randomUUID() },
        context,
      )
    ).wait(context);
  expect(await submit()).toMatchObject({ status: "unanswered" });
  const state = await runtime.harness.snapshot(
    EngineDoc,
    runtime.botId,
    context,
  );
  expect(state?.sessions?.[state.sessionKey ?? ""]?.through).toBe(null);
  Object.assign(runtime, await runtime.reopen());
  expect(await submit()).toMatchObject({ status: "done" });
  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain(cases.fact);
});

test("history reads recover Unicode text, selected sources and linked tool calls within one Bot", async () => {
  const runtime = await openContext(() => {});
  const text =
    "资料🙂".repeat(cases.longMessage.prefixBytes) + cases.longMessage.tail;
  const records = await runtime.harness.commit(async (tx) => {
    const long = await tx.appendEntry(runtime.botId, {
      kind: EngineMessage,
      data: {
        id: "long",
        role: "user",
        stopped: false,
        content: [
          { type: "text", text },
          { type: "thinking", thinking: "PRIVATE_REASONING" },
          { type: "image", mimeType: "image/png", data: "PRIVATE_IMAGE_DATA" },
        ],
        materials: {
          skills: [],
          context: [
            {
              id: "source",
              type: "text",
              botId: runtime.botId,
              text: cases.referenceFact,
            },
          ],
        },
      },
    });
    const tool = await tx.appendEntry(runtime.botId, {
      kind: EngineMessage,
      data: {
        id: "call",
        role: "assistant",
        stopped: false,
        content: [
          {
            type: "toolCall",
            id: "call-1",
            name: "write",
            arguments: { path: "blue/report.txt" },
          },
        ],
      },
    });
    const result = await tx.appendEntry(runtime.botId, {
      kind: EngineMessage,
      data: {
        id: "result",
        role: "toolResult",
        stopped: false,
        toolCallId: "call-1",
        toolName: "write",
        content: [{ type: "text", text: "Saved" }],
      },
    });
    const embedded = await tx.appendEntry(runtime.botId, {
      kind: "test.model",
      model: [
        { role: "user", content: "Embedded fact", timestamp: 1 },
        {
          role: "toolResult",
          toolCallId: "embedded-call",
          toolName: "read",
          content: [{ type: "text", text: "Embedded result" }],
          isError: false,
          timestamp: 2,
        },
      ],
    });
    return {
      long: long.id,
      tool: tool.id,
      result: result.id,
      embedded: embedded.id,
    };
  }, context);
  const read = async (
    args: Record<string, unknown>,
    reader = runtime.reader,
  ) => {
    const result = await callProductTool(
      reader,
      "read",
      "conversation_read",
      args,
      context,
    );
    const part = result.content[0];
    if (part?.type !== "text") throw new Error("History text required");
    expect(Buffer.byteLength(part.text)).toBeLessThanOrEqual(16_000);
    return JSON.parse(part.text);
  };
  let offset: number | null = 0;
  let complete = "";
  while (offset !== null) {
    const page = await read({ entryId: records.long, offset });
    expect(page.text).not.toContain("�");
    complete += page.text;
    offset = page.nextOffset;
  }
  expect(JSON.parse(complete)[0].text).toContain(text);
  expect(complete).toContain(cases.referenceFact);
  expect(complete).not.toContain("PRIVATE_");
  const insideCharacter = Buffer.from(complete).indexOf(Buffer.from("资")) + 1;
  await expect(
    read({ entryId: records.long, offset: insideCharacter }),
  ).rejects.toThrow("偏移");
  expect((await read({ entryId: records.tool })).text).toContain(
    "blue/report.txt",
  );
  expect((await read({ entryId: records.result })).text).toContain("call-1");
  const embedded = JSON.parse((await read({ entryId: records.embedded })).text);
  expect(embedded).toHaveLength(2);
  expect(embedded[1]).toMatchObject({
    toolCallId: "embedded-call",
    tool: "read",
    text: "Embedded result",
  });
  const page = await read({});
  expect(JSON.stringify(page)).toContain("blue/report.txt");
  expect(JSON.stringify(page)).not.toContain(cases.longMessage.tail);
  const older = await read({ before: records.long });
  expect(JSON.stringify(older)).toContain(cases.fact);
  await expect(
    read({ entryId: records.long }, {
      ...runtime.reader,
      conversationId: -1,
    } as EngineRuntime),
  ).rejects.toThrow("不存在");
  for (const args of [
    { offset: 1 },
    { entryId: records.long, before: records.tool },
    { entryId: records.long, offset: -1 },
    { entryId: Number.MAX_SAFE_INTEGER },
    { entryId: records.long, offset: Number.MAX_SAFE_INTEGER },
  ])
    await expect(read(args)).rejects.toThrow();
  expect(
    await conversationHistory(
      runtime.reader,
      null,
      context,
      records.embedded as EntryId,
    ),
  ).toBe("");
  await runtime.harness.commit(async (tx) => {
    for (let i = 0; i < 64; i++)
      await tx.appendEntry(runtime.botId, { kind: "test.internal", data: {} });
  }, context);
  const gap = await read({});
  expect(gap.messages).toEqual([]);
  expect(gap.from).toBeGreaterThan(records.result);
  expect(JSON.stringify(await read({ before: gap.from }))).toContain(
    "blue/report.txt",
  );
});

test.each(engineIds)(
  "%s uses the opened target's budget across model and Harness changes",
  async (harness) => {
    const runtime = await openContext(() => {});
    const prompts: { text: string; budget: number }[] = [];
    let window = 50_000;
    const native = new Map<string, string | null>();
    const other = harness === "codex" ? "pi" : "codex";
    for (const id of [harness, other] as const) {
      const mock = vi
        .spyOn(engineProvider(id), "open")
        .mockImplementation(async (options) => {
          native.set(id, options.sessionId);
          const sessionId = `native-${id}`;
          await options.emit({ type: "session", id: sessionId });
          await options.emit({
            type: "context",
            tokens: 0,
            window,
            source: "fixture",
            basis: "window",
            estimated: false,
            model: options.config.model,
          });
          return {
            id: sessionId,
            prompt: async (text) => {
              const doc = await runtime.harness.snapshot(
                EngineDoc,
                runtime.botId,
                context,
              );
              if (!doc) throw new Error("Bot state required");
              prompts.push({
                text,
                budget: handoffBudget(
                  doc,
                  doc.prompt?.text ?? "",
                  "Current",
                  runtime.catalogs.at(-1) ?? [],
                  [],
                ),
              });
              await options.emit({ type: "accepted", id: crypto.randomUUID() });
              await options.emit({
                type: "message",
                id: "answer",
                text: "Done",
              });
            },
            interrupt: async () => {},
            answer: async () => {},
            models: async () => [],
          };
        });
      onTestFinished(() => mock.mockRestore());
    }
    const submit = async (provider: typeof harness, model: string) => {
      await runtime.harness.commit(async (tx) => {
        const doc = await tx.doc(EngineDoc, runtime.botId);
        doc.config = { provider, model };
        doc.runtime = { contextWindow: 1_000_000 };
        for (let i = 0; i < 6; i++)
          await tx.appendEntry(runtime.botId, {
            kind: EngineMessage,
            data: {
              id: crypto.randomUUID(),
              role: "user",
              content: [{ type: "text", text: '"资料🙂\n'.repeat(1200) }],
              stopped: false,
            },
          });
      }, context);
      const task = await runtime.engines.submit(
        runtime.botId,
        { text: "Current", requestId: crypto.randomUUID() },
        context,
      );
      return task.wait(context);
    };
    expect(await submit(harness, "large")).toMatchObject({ status: "done" });
    window = 12_000;
    expect(await submit(harness, "small")).toMatchObject({ status: "done" });
    expect(native.get(harness)).toBe(`native-${harness}`);
    expect(prompts[1]?.text.length).toBeLessThan(prompts[0]?.text.length ?? 0);
    for (const prompt of prompts) {
      const json = prompt.text.slice(
        prompt.text.indexOf("\n") + 1,
        prompt.text.lastIndexOf("\n\nCurrent request:"),
      );
      expect(Buffer.byteLength(json)).toBeLessThanOrEqual(prompt.budget);
      expect(Buffer.byteLength(json)).toBeLessThanOrEqual(16_000);
      const packet = JSON.parse(json);
      expect(packet.excerpt).toBe(true);
      expect(
        packet.messages.some(
          (message: { excerpt?: boolean }) => message.excerpt,
        ),
      ).toBe(true);
      expect(json).not.toContain("�");
    }
    window = 50_000;
    expect(await submit(other, "other")).toMatchObject({
      status: "done",
    });
    expect(await submit(harness, "small")).toMatchObject({ status: "done" });
    expect(native.get(harness)).toBe(`native-${harness}`);
    const sent = prompts.length;
    window = 2000;
    expect(await submit(harness, "tiny")).toMatchObject({
      status: "unanswered",
    });
    expect(prompts).toHaveLength(sent);
    const doc = await runtime.harness.snapshot(
      EngineDoc,
      runtime.botId,
      context,
    );
    expect(doc?.dispatch).toBe("ready");
    expect(doc?.error).toContain("预算");
  },
);

test("budget reserves tools, images, retained context and output for the matching target", async () => {
  const runtime = await openContext(() => {});
  const doc: EngineState | undefined = structuredClone(
    await runtime.harness.snapshot(EngineDoc, runtime.botId, context),
  );
  if (!doc) throw new Error("Bot state required");
  doc.config.model = "small";
  doc.sessionId = "native";
  doc.runtime = {
    contextWindow: 20_000,
    contextTokens: 1000,
    context: {
      harness: "codex",
      sessionId: "native",
      model: "small",
      observedAt: Date.now(),
      source: "fixture",
      basis: "window",
      estimated: false,
    },
  };
  const budget = handoffBudget(doc, "System", "User", [], []);
  expect(
    handoffBudget(doc, "System", "User", [{ schema: "x".repeat(2000) }], []),
  ).toBeLessThan(budget - 2000);
  const withImage = handoffBudget(
    doc,
    "System",
    "User",
    [],
    [{ type: "image", mimeType: "image/png", data: "x".repeat(3000) }],
  );
  expect(withImage).toBeLessThan(budget);
  expect(
    handoffBudget(
      doc,
      "System",
      "User",
      [],
      [{ type: "image", mimeType: "image/png", data: "x".repeat(300_000) }],
    ),
  ).toBe(withImage);
  doc.runtime.contextTokens = 2000;
  expect(handoffBudget(doc, "System", "User", [], [])).toBe(budget - 1000);
  if (!doc.runtime.context) throw new Error("Context reading required");
  doc.runtime.context.model = "canonical-small";
  doc.runtime.context.configuredModel = "small";
  expect(handoffBudget(doc, "System", "User", [], [])).toBe(budget - 1000);
  doc.config.model = "other";
  expect(handoffBudget(doc, "System", "User", [], [])).toBe(16_000);
});
