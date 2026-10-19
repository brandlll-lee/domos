import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry } from "@earendil-works/pi-durable";
import { expect, onTestFinished, test } from "vitest";
import type { Computers } from "../src/computer/catalog.ts";
import { openAgent } from "../src/open-agent.ts";
import { ProtocolProcess } from "./fixtures/engine-process.ts";

test("engine connection readiness follows the selected work computer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-engine-computer-"));
  const models = createModels();
  models.setProvider(fauxProvider().provider);
  let computerId = "shared";
  const computers = {
    initialize: async () => {},
    computerId: async () => computerId,
    process: async () => {
      const worker = new ProtocolProcess();
      worker.receive = (request) => {
        worker.response(
          request,
          request.method === "account/read"
            ? { account: { type: "apiKey" } }
            : { thread: { id: "connection-check" }, data: [] },
        );
      };
      return worker;
    },
    tools: { catalog: async () => [], finish: () => {} },
  } as unknown as Computers;
  const runtime = await openAgent(
    join(directory, "agent.sqlite"),
    { registry: createRegistry(), models, computers },
    {},
    context,
  );
  onTestFinished(async () => {
    await runtime.harness.close(context);
    await rm(directory, { recursive: true, force: true });
  });
  const engines = runtime.engines;
  if (!engines) throw new Error("Native engines required");
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
  await engines.prepare(botId, context);
  expect((await engines.profile(botId, context)).prepared).toBe(true);
  computerId = "dedicated";
  expect((await engines.profile(botId, context)).prepared).toBe(false);
  await engines.prepare(botId, context);
  expect((await engines.profile(botId, context)).prepared).toBe(true);
  computerId = "shared";
  expect((await engines.profile(botId, context)).prepared).toBe(false);
});

test("routines use the selected native engine and stopping settles queued work", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-native-routine-"));
  const models = createModels();
  models.setProvider(fauxProvider().provider);
  const workers: ProtocolProcess[] = [];
  const computers = {
    initialize: async () => {},
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
          worker.response(request, { thread: { id: "routine-thread" } });
        else if (request.method === "turn/start") {
          worker.response(request, { turn: { id: `turn-${workers.length}` } });
          if (workers.length === 1)
            worker.frame({
              method: "turn/completed",
              params: { turn: { status: "completed" } },
            });
          else
            worker.frame({
              id: "approval",
              method: "item/commandExecution/requestApproval",
              params: { command: "make-report", cwd: "/work/bots/1" },
            });
        } else if (request.id !== undefined) worker.response(request, {});
      };
      return worker;
    },
    tools: { catalog: async () => [], finish: () => {} },
  } as unknown as Computers;
  const runtime = await openAgent(
    join(directory, "agent.sqlite"),
    { registry: createRegistry(), models, computers },
    {},
    context,
  );
  onTestFinished(async () => {
    await runtime.harness.close(context);
    await Promise.all(workers.map((worker) => worker.close()));
    await rm(directory, { recursive: true, force: true });
  });
  const engines = runtime.engines;
  if (!engines) throw new Error("Native engines required");
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
  const routine = await runtime.work.routines.save(
    botId,
    {
      id: crypto.randomUUID(),
      revision: 0,
      title: "Report",
      instructions: "Prepare the daily report",
      schedule: { type: "cron", expression: "0 9 * * *", timeZone: "UTC" },
      skillIds: [],
      requestId: crypto.randomUUID(),
    },
    context,
  );
  const first = await runtime.work.routines.test(
    botId,
    routine.id,
    crypto.randomUUID(),
    context,
  );
  await runtime.harness.waitForTask(first, context);
  expect(
    (await runtime.work.routines.list(botId, context)).runs[0]?.status,
  ).toBe("done");
  expect(
    JSON.stringify(
      workers[0]?.requests.find((request) => request.method === "turn/start")
        ?.params,
    ),
  ).toContain("Prepare the daily report");
  const active = await engines.submit(
    botId,
    { text: "Wait for permission", requestId: crypto.randomUUID() },
    context,
  );
  await expect
    .poll(async () => (await engines.view(botId, context)).approvals?.length)
    .toBe(1);
  const queued = await runtime.work.routines.test(
    botId,
    routine.id,
    crypto.randomUUID(),
    context,
  );
  await expect
    .poll(
      async () =>
        (await runtime.work.routines.list(botId, context)).runs[1]
          ?.submissionId,
    )
    .toEqual(expect.any(Number));
  await engines.stop(botId, context);
  expect(
    workers[1]?.requests.some((request) => request.method === "turn/interrupt"),
  ).toBe(true);
  await runtime.harness.waitForTask(queued, context);
  expect(await active.wait(context)).toMatchObject({
    status: "unanswered",
    reason: "aborted",
  });
  expect(
    (await runtime.work.routines.list(botId, context)).runs[1]?.status,
  ).toBe("stopped");
  expect((await engines.view(botId, context)).approvals).toEqual([]);
  expect((await engines.profile(botId, context)).busy).toBe(false);
  await expect(
    engines.answer(botId, "approval", { allow: true }, context),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(workers).toHaveLength(2);
});
