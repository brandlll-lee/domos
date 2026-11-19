import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { defineExtension, defineTask } from "@earendil-works/pi-durable";
import { expect, test } from "vitest";
import type { EngineTaskInput } from "../src/harness/task-types.ts";
import type { EngineUsage } from "../src/harness/types.ts";
import { finishUsage, recordUsage, UsageReader } from "../src/harness/usage.ts";
import { runtimeFixture } from "./fixtures/runtime.ts";

test("durable usage commits cumulative increments once across reopening and counter resets", async () => {
  const fixture = await runtimeFixture();
  let runtime = { harness: fixture.harness };
  let sample: EngineUsage;
  const task = defineTask<EngineTaskInput, { phase: "run" }, null, object>({
    name: "fixture.usage",
    version: 1,
    initial: () => ({ phase: "run" }),
    async abort() {
      throw new Error("Unexpected cancellation");
    },
    phases: {
      async run(state, current) {
        await current.commit(async (tx) => {
          await recordUsage(tx, current.taskId, sample);
          await recordUsage(tx, current.taskId, sample);
          await finishUsage(
            tx,
            current,
            "codex",
            "native-session",
            state.input,
          );
          await finishUsage(
            tx,
            current,
            "codex",
            "native-session",
            state.input,
          );
          return {
            status: "terminal",
            outcome: { status: "completed", result: null },
          };
        }, context);
      },
    },
  });
  fixture.registry.install(
    defineExtension({ name: "fixture.usage", tasks: [task] }),
  );
  const botId = fixture.conversation.id;
  const run = async (input: number, cost: number) => {
    sample = {
      id: "native-counter",
      source: "fixture",
      provider: "test",
      model: "model",
      input,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      costUsd: null,
      tokenBasis: "uncached",
      tokensCumulative: {
        input,
        output: input / 10,
        cacheRead: 0,
        cacheWrite: 0,
      },
      tokensBaseline: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      counterId: "native-counter",
      nativeSessionId: "native-session",
      computerId: "local",
      accountId: "account",
      costCumulative: cost,
      costCounter: "native-counter",
      costInitial: true,
    };
    const id = await runtime.harness.commit(
      (tx) =>
        tx.createTask(
          task,
          { text: "", turnId: crypto.randomUUID(), previous: null },
          {
            ownership: { kind: "conversation" },
            conversationId: botId,
            background: true,
          },
        ),
      context,
    );
    await expect
      .poll(
        async () => (await runtime.harness.getTask(id, context))?.state.status,
      )
      .toBe("terminal");
  };
  await run(100, 1);
  await run(150, 1.5);
  runtime = await fixture.reopen();
  await run(200, 2);
  await run(20, 0.2);
  await run(50, 0.5);
  const reader = new UsageReader(runtime.harness);
  const rows = (await reader.read([botId], {}, context)).items;
  expect(rows).toHaveLength(5);
  expect(rows.reduce((total, row) => total + (row.input ?? 0), 0)).toBe(230);
  expect(
    rows.reduce((total, row) => total + (row.costUsd ?? 0), 0),
  ).toBeCloseTo(2.3);
  const reset = rows.find((row) => row.costCumulative === 0.2);
  expect(reset).toMatchObject({ input: null, output: null, costUsd: null });
  expect(reset?.pricingReason).toContain("重置");
});
