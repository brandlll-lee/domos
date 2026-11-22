import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { ConversationId } from "@earendil-works/pi-durable";
import { expect, onTestFinished, test } from "vitest";
import type { Computers } from "../src/computer/catalog.ts";
import {
  BotSession,
  createBotSession,
  owningBot,
  privateSession,
} from "../src/conversations.ts";
import { EngineDoc } from "../src/harness/state.ts";
import { featureProcess } from "./fixtures/feature-process.ts";
import { runtimeFixture } from "./fixtures/runtime.ts";

test("work conversations retain their Bot configuration and separate history", async () => {
  const { harness, conversation, bots } = await runtimeFixture();
  const peer = await bots.create(
    { name: "Reviewer", instructions: "Review changes", requestId: "reviewer" },
    context,
  );
  await harness.commit(async (tx) => {
    (await tx.doc(EngineDoc, peer.id)).config = {
      provider: "codex",
      model: "review-model",
    };
  }, context);
  const id = await createBotSession(
    harness,
    peer.id,
    { purpose: "delegation", origin: conversation.id },
    context,
  );
  expect(id).not.toBe(peer.id);
  expect(await owningBot(harness, id, context)).toBe(peer.id);
  expect(await owningBot(harness, conversation.id, context)).toBe(
    conversation.id,
  );
  expect(await harness.snapshot(BotSession, id, context)).toMatchObject({
    botId: peer.id,
    purpose: "delegation",
    origin: conversation.id,
  });
  expect((await harness.snapshot(EngineDoc, id, context))?.config).toEqual({
    provider: "codex",
    model: "review-model",
  });
  const session = await harness.conversation(id, context);
  assert(session);
  expect((await session.agent(context)).instructions).toBe("Review changes");
  expect(
    (await session.entries({}, 10, undefined, context)).items,
  ).toHaveLength(0);
  await expect(
    createBotSession(
      harness,
      999999 as ConversationId,
      { purpose: "delegation" },
      context,
    ),
  ).rejects.toThrow();
});

test("private conversations inherit once and retain independent native contexts across restart", async () => {
  const workers: ReturnType<typeof featureProcess>[] = [];
  const computers = {
    initialize: async () => {},
    preflight: async () => {},
    attach: async () => {},
    computerId: async () => "local",
    binding: async () => ({ directory: null }),
    tools: { catalog: async () => [], finish: () => {} },
    process: async () => {
      const worker = featureProcess(async () => "Done");
      workers.push(worker);
      const receive = worker.receive;
      const native = `/native/private-${workers.length}`;
      worker.receive = (request) =>
        request.type === "get_state"
          ? worker.frame({
              type: "response",
              id: request.id,
              success: true,
              data: {
                sessionFile: native,
                model: {
                  provider: "test-provider",
                  id: "test-model",
                  input: ["text"],
                },
              },
            })
          : receive(request);
      return worker;
    },
  } as unknown as Computers;
  const fixture = await runtimeFixture(computers);
  const { harness, bots, conversation, engines } = fixture;
  assert(engines);
  onTestFinished(async () => {
    await Promise.all(workers.map((worker) => worker.close()));
  });
  const send = async (id: number, text: string) =>
    (
      await engines.submit(
        id,
        { text, requestId: crypto.randomUUID() },
        context,
      )
    ).wait(context);
  await send(conversation.id, "原有任务");
  const original = (await harness.snapshot(EngineDoc, conversation.id, context))
    ?.sessionId;
  expect(original).toBeTruthy();
  const request = crypto.randomUUID();
  const second = await bots.createSession(
    conversation.id,
    conversation.id,
    request,
    context,
  );
  expect(
    await bots.createSession(
      conversation.id,
      conversation.id,
      request,
      context,
    ),
  ).toBe(second);
  const third = await bots.createSession(
    conversation.id,
    second,
    crypto.randomUUID(),
    context,
  );
  const secondConversation = await bots.conversation(second, context);
  assert(secondConversation);
  expect(
    (await secondConversation.entries({}, 20, undefined, context)).items,
  ).toHaveLength(0);
  await harness.commit(async (tx) => {
    (await tx.doc(EngineDoc, second)).config.model =
      "test-provider/test-model-2";
  }, context);
  await send(second, "准备面试\n请检查要求");
  expect(
    (await harness.snapshot(EngineDoc, second, context))?.config.model,
  ).toBe("test-provider/test-model-2");
  expect(
    (await harness.snapshot(EngineDoc, second, context))?.sessionId,
  ).not.toBe(original);
  await send(third, "分析账单");
  await send(conversation.id, "继续原有任务");
  expect(
    (await harness.snapshot(EngineDoc, conversation.id, context))?.sessionId,
  ).toBe(original);
  await bots.updateSession(
    conversation.id,
    second,
    { title: "面试资料", archived: true },
    context,
  );
  await send(second, "不要改名");
  expect((await bots.list(context))[0]?.conversations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: second,
        title: "面试资料",
        archived: true,
      }),
      expect.objectContaining({ id: third, title: "分析账单" }),
    ]),
  );
  const peer = await bots.create({ name: "Other", requestId: "peer" }, context);
  await expect(
    privateSession(harness, peer.id, second, context),
  ).rejects.toThrow("会话不存在");
  await expect(
    bots.createSession(peer.id, second, crypto.randomUUID(), context),
  ).rejects.toThrow("会话不存在");
  const reopened = await fixture.reopen();
  expect((await reopened.bots.list(context))[0]?.conversations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: second,
        title: "面试资料",
        archived: true,
      }),
    ]),
  );
  expect(
    (await reopened.harness.snapshot(EngineDoc, conversation.id, context))
      ?.sessionId,
  ).toBe(original);
});

test("one Bot queues private turns and stopping a queued conversation leaves active work intact", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const started: number[] = [];
  const workers: ReturnType<typeof featureProcess>[] = [];
  let owner = 0;
  let released = false;
  let overlap = false;
  const computers = {
    initialize: async () => {},
    preflight: async () => {},
    attach: async () => {},
    computerId: async () => "local",
    binding: async () => ({ directory: null }),
    tools: { catalog: async () => [], finish: () => {} },
    process: async (id: number) => {
      const worker = featureProcess(async () => {
        started.push(id);
        if (id !== owner && !released) overlap = true;
        if (id === owner) {
          entered.resolve();
          await release.promise;
        }
        return "Done";
      });
      workers.push(worker);
      return worker;
    },
  } as unknown as Computers;
  const { harness, bots, engines, conversation } =
    await runtimeFixture(computers);
  assert(engines);
  onTestFinished(async () => {
    release.resolve();
    await Promise.all(workers.map((worker) => worker.close()));
  });
  owner = conversation.id;
  const second = await bots.createSession(
    owner,
    owner,
    crypto.randomUUID(),
    context,
  );
  const third = await bots.createSession(
    owner,
    second,
    crypto.randomUUID(),
    context,
  );
  const first = await engines.submit(
    owner,
    { text: "运行测试", requestId: "first" },
    context,
  );
  await entered.promise;
  const queued = await engines.submit(
    second,
    { text: "准备面试", requestId: "second" },
    context,
  );
  const next = await engines.submit(
    third,
    { text: "分析账单", requestId: "third" },
    context,
  );
  expect(started).toEqual([owner]);
  await engines.stop(second, context);
  expect(
    (await harness.snapshot(EngineDoc, conversation.id, context))?.run?.status,
  ).toBe("running");
  expect(started).toEqual([owner]);
  released = true;
  release.resolve();
  await Promise.all([
    first.wait(context),
    queued.wait(context),
    next.wait(context),
  ]);
  expect(started).toEqual([owner, third]);
  expect(overlap).toBe(false);
});
