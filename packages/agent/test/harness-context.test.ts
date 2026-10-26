import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, defineExtension } from "@earendil-works/pi-durable";
import { expect, onTestFinished, test } from "vitest";
import type { Computers } from "../src/computer/catalog.ts";
import { EngineExecution, Engines, engineTask } from "../src/harness/index.ts";
import { EngineDoc, EngineMessage } from "../src/harness/state.ts";
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
  return { ...runtime, botId, engines, workers };
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
