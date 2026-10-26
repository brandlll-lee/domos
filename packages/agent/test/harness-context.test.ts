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
import { expect, onTestFinished, test } from "vitest";
import type { Computers } from "../src/computer/catalog.ts";
import { conversationHistory } from "../src/harness/history.ts";
import { EngineExecution, Engines, engineTask } from "../src/harness/index.ts";
import { callProductTool } from "../src/harness/product-tools.ts";
import { EngineDoc, EngineMessage } from "../src/harness/state.ts";
import type { EngineRuntime } from "../src/harness/task-types.ts";
import { openAgent } from "../src/open-agent.ts";
import { ProtocolProcess, type Request } from "./fixtures/engine-process.ts";
import cases from "./fixtures/harness-context.json" with { type: "json" };

async function openContext(
  receive: (worker: ProtocolProcess, request: Request) => void,
) {
  const directory = await mkdtemp(join(tmpdir(), "domos-context-"));
  const workers: ProtocolProcess[] = [];
  const execution = new EngineExecution({
    preflight: async () => {},
    computerId: async () => "shared",
    process: async () => {
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
  const runtime = await openAgent(
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
  return { ...runtime, botId, engines, workers, reader };
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
    expect(await submit("Next request")).toMatchObject({ status: "done" });
    expect(prompts[0]).toContain(cases.fact);
    expect(prompts[1]?.includes(cases.fact)).toBe(delivery === "rejected");
    expect(
      runtime.workers[1]?.requests.some((r) => r.method === "thread/resume"),
    ).toBe(true);
  },
);

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
        content: [{ type: "text", text }],
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
    return { long: long.id, tool: tool.id, result: result.id };
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
  expect((await read({ entryId: records.tool })).text).toContain(
    "blue/report.txt",
  );
  expect((await read({ entryId: records.result })).text).toContain("call-1");
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
      records.result as EntryId,
    ),
  ).toBe("");
});
