import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { defineDoc, defineTask } from "@earendil-works/pi-durable";
import { expect, test } from "vitest";
import { ComputerRequests } from "../src/computer/runtime.ts";
import { EngineDoc, EngineMessage } from "../src/harness/state.ts";
import { messageText } from "../src/messages.ts";
import { migrateRuntime } from "../src/runtime/migrate.ts";
import { runtimeFixture } from "./fixtures/runtime.ts";

const Migration = defineDoc({
  kind: "domos.runtime-migration",
  version: 1,
  scope: "conversation",
  checkpointWhen: () => false,
  history: "latest",
  fork: "initial",
  initial: () => ({ complete: false }),
});

test("migration retains messages, selected material and memory and imports context once", async () => {
  const runtime = await runtimeFixture();
  const id = runtime.conversation.id;
  const memoryId = crypto.randomUUID();
  const task = defineTask({
    name: "domos.engine",
    version: 1,
    initial: () => ({ phase: "run" as const }),
    abort: async () => {
      throw new Error("Unexpected execution");
    },
    phases: {
      run: async () => {
        throw new Error("Unexpected execution");
      },
    },
  });
  await runtime.work.memory.save(
    id,
    {
      id: memoryId,
      text: "Saved preference",
      shared: false,
      revision: 0,
      requestId: crypto.randomUUID(),
    },
    context,
  );
  const oldSubmission = await runtime.harness.commit(async (tx) => {
    (await tx.doc(Migration, id)).complete = false;
    const submissionId = (
      await tx.createSubmission({
        type: "input",
        status: "queued",
        conversationId: id,
      })
    ).id;
    (await tx.doc(EngineDoc, id)).tasks = [
      await tx.createTask(
        task,
        { submissionId },
        { conversationId: id, ownership: { kind: "conversation" } },
      ),
    ];
    await tx.appendEntry(id, {
      kind: EngineMessage,
      data: {
        id: "old-input",
        role: "user",
        stopped: false,
        content: [{ type: "text", text: "Historical request", key: "text" }],
        materials: { context: [{ text: "Selected text" }] },
      },
    });
    (await tx.doc(EngineDoc, id)).drafts = [
      {
        id: "partial",
        role: "assistant",
        stopped: false,
        content: [{ type: "text", text: "Partial result", key: "text" }],
      },
    ];
    return submissionId;
  }, context);
  await migrateRuntime(runtime.harness, id, context);
  expect(
    (
      await (
        await runtime.harness.submission(oldSubmission, context)
      )?.status(context)
    )?.status,
  ).toBe("unanswered");
  const first = await runtime.conversation.context(context);
  expect(JSON.stringify(first.messages)).toContain("Historical request");
  expect(JSON.stringify(first.messages)).toContain("Selected text");
  expect(JSON.stringify(first.messages)).toContain("Partial result");
  expect(
    (await runtime.engines.view(id, context)).messages.map(messageText),
  ).toContain("Historical request");
  const reopened = await runtime.reopen();
  expect(
    (await reopened.work.memory.list(id, context)).some(
      (item) => item.id === memoryId && item.text === "Saved preference",
    ),
  ).toBe(true);
  const entries = await reopened.conversation.entries(
    {},
    100,
    undefined,
    context,
  );
  expect(
    entries.items.filter((entry) => entry.kind === "domos.context-history"),
  ).toHaveLength(1);
  expect(
    (await reopened.engines.view(id, context)).messages.find(
      (message) => message.id === "partial",
    ),
  ).toMatchObject({ stopped: true, pending: false });
});

test("pending computer confirmations expire on restart and cannot execute", async () => {
  const runtime = await runtimeFixture();
  const id = runtime.conversation.id;
  const requestId = crypto.randomUUID();
  await runtime.harness.commit(async (tx) => {
    (await tx.doc(ComputerRequests, id)).approvals.push({
      id: requestId,
      title: "Browser",
      detail: "Take over",
      kind: "permission",
      takeover: {
        id: requestId,
        service: "browser",
        computerId: "bound",
        revision: 1,
        state: "waiting",
      },
    });
  }, context);
  const reopened = await runtime.reopen();
  expect((await reopened.engines.view(id, context)).approvals).toEqual([]);
  expect(
    (await reopened.engines.view(id, context)).messages.at(-1)?.takeover?.state,
  ).toBe("expired");
  await expect(
    reopened.engines.answer(id, requestId, { allow: true }, context),
  ).rejects.toThrow();
});

test("native submissions retain acceptance and do not duplicate after reopening", async () => {
  const runtime = await runtimeFixture();
  runtime.faux.setResponses([fauxAssistantMessage("Saved answer")]);
  const input = { text: "Remember this", requestId: crypto.randomUUID() };
  const first = await runtime.engines.submit(
    runtime.conversation.id,
    input,
    context,
  );
  expect((await first.wait(context)).status).toBe("done");
  const reopened = await runtime.reopen();
  const repeated = await reopened.engines.submit(
    runtime.conversation.id,
    input,
    context,
  );
  expect(repeated.id).toBe(first.id);
  expect((await repeated.wait(context)).status).toBe("done");
  expect(runtime.faux.state.callCount).toBe(1);
});

test("context compaction keeps the complete displayed transcript across restart", async () => {
  const runtime = await runtimeFixture();
  runtime.faux.setResponses([fauxAssistantMessage("Original answer")]);
  const input = await runtime.engines.submit(
    runtime.conversation.id,
    { text: "Original request", requestId: crypto.randomUUID() },
    context,
  );
  await input.wait(context);
  const before = await runtime.engines.view(runtime.conversation.id, context);
  await runtime.conversation.submit(
    {
      type: "write",
      entry: {
        kind: "pi.compaction",
        head: "self",
        model: [{ role: "user", content: "Summary", timestamp: Date.now() }],
      },
    },
    context,
  );
  const compacted = await runtime.engines.view(
    runtime.conversation.id,
    context,
  );
  expect(compacted.messages).toEqual(before.messages);
  expect(compacted.runtime?.contextTokens).not.toBe(
    before.runtime?.contextTokens,
  );
  expect(
    JSON.stringify((await runtime.conversation.context(context)).messages),
  ).not.toContain("Original request");
  const reopened = await runtime.reopen();
  expect(
    (await reopened.engines.view(runtime.conversation.id, context)).messages,
  ).toEqual(before.messages);
});
