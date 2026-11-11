import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { expect, onTestFinished, test } from "vitest";
import { DelegationsDoc } from "../src/collaboration.ts";
import type { Computers } from "../src/computer/catalog.ts";
import { BotSession } from "../src/conversations.ts";
import { EngineDoc, EngineMessage } from "../src/harness/state.ts";
import { Teams } from "../src/teams.ts";
import { ProtocolProcess } from "./fixtures/engine-process.ts";
import { featureProcess } from "./fixtures/feature-process.ts";
import { runtimeFixture } from "./fixtures/runtime.ts";

test("teams retain members, owner and separate member conversations", async () => {
  const { harness, bots, conversation } = await runtimeFixture();
  const peer = await bots.create(
    { name: "Reviewer", requestId: "reviewer" },
    context,
  );
  const teams = new Teams(harness);
  const input = {
    id: "release",
    name: "Release",
    purpose: "Ship changes",
    members: [conversation.id, peer.id],
    owner: conversation.id,
  };
  await teams.create(input, context);
  await teams.create(input, context);
  expect(await teams.list(context)).toEqual([input]);
  const owner = await teams.session(input.id, undefined, context);
  expect(await teams.session(input.id, conversation.id, context)).toBe(owner);
  const member = await teams.session(input.id, peer.id, context);
  expect(member).not.toBe(owner);
  expect(await harness.snapshot(BotSession, member, context)).toMatchObject({
    botId: peer.id,
    teamId: "release",
    purpose: "team",
  });
  await expect(teams.session(input.id, 999999, context)).rejects.toThrow(
    "团队",
  );
  await expect(
    teams.create({ ...input, id: "invalid", owner: 999999 }, context),
  ).rejects.toThrow();
});

test("stopping a team cancels its pending peer work and preserves private work", async () => {
  const workers: ReturnType<typeof featureProcess>[] = [];
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let ownerSession = 0;
  let peerId = 0;
  const computers = {
    initialize: async () => {},
    attach: async () => {},
    preflight: async () => {},
    computerId: async () => "shared",
    binding: async () => ({ directory: null }),
    tools: { catalog: async () => [], finish: () => {} },
    process: async (
      id: number,
      _tools: unknown,
      invoke: Parameters<Computers["process"]>[2],
    ) => {
      const worker = featureProcess(async () => {
        if (id === ownerSession) {
          const result = await invoke(
            "send",
            "bot_send",
            { botId: peerId, task: "Review" },
            new AbortController().signal,
          );
          expect(result.isError).not.toBe(true);
          return "Sent";
        }
        started.resolve();
        await release.promise;
        return "Done";
      });
      workers.push(worker);
      return worker;
    },
  } as unknown as Computers;
  const fixture = await runtimeFixture(computers);
  const { harness, bots, conversation, engines } = fixture;
  assert(engines?.collaboration);
  const collaboration = engines.collaboration;
  peerId = (
    await bots.create({ name: "Peer", requestId: "team-peer" }, context)
  ).id;
  const teams = new Teams(harness);
  const team = {
    id: "team",
    name: "Team",
    purpose: "Review",
    members: [conversation.id, peerId],
    owner: conversation.id,
  };
  await teams.create(team, context);
  ownerSession = await teams.session(team.id, undefined, context);
  onTestFinished(async () => {
    release.resolve();
    await Promise.all(workers.map((worker) => worker.close()));
  });
  const privateTask = await engines.submit(
    peerId,
    { text: "Private task", requestId: "private" },
    context,
  );
  await started.promise;
  await (
    await engines.submit(
      ownerSession,
      { text: "Review", requestId: "team-review" },
      context,
    )
  ).wait(context);
  await started.promise;
  const item = (await harness.snapshot(DelegationsDoc, context))?.items[0];
  assert(item);
  await teams.stop(team.id, engines, context);
  expect((await engines.view(peerId, context)).busy).toBe(true);
  release.resolve();
  expect(await privateTask.wait(context)).toMatchObject({ status: "done" });
  expect(await collaboration.record(item.id, context)).toMatchObject({
    cancelled: true,
  });
  expect(
    (await engines.view(ownerSession, context)).messages.some(
      (message) => message.requestId === `delegation-result:${item.id}`,
    ),
  ).toBe(false);
});

test("native Bot delegation returns asynchronously and keeps private history separate", async () => {
  const workers: ProtocolProcess[] = [];
  const prompts: number[] = [];
  let peerId = 0;
  const computers = {
    initialize: async () => {},
    attach: async () => {},
    preflight: async () => {},
    computerId: async () => "shared",
    binding: async () => ({ directory: null }),
    tools: { catalog: async () => [], finish: () => {} },
    process: async (
      id: number,
      _tools: unknown,
      invoke: Parameters<Computers["process"]>[2],
    ) => {
      const worker = featureProcess(async () => {
        prompts.push(id);
        if (id !== 1) return "Review found no issue.";
        if (prompts.filter((item) => item === 1).length > 1)
          return "I received the review.";
        const peers = await invoke(
          "peers",
          "bot_list",
          {},
          new AbortController().signal,
        );
        expect(JSON.stringify(peers)).toContain("Reviewer");
        const sent = await invoke(
          "delegate",
          "bot_send",
          {
            botId: peerId,
            task: "Review this change",
            completion: "Return findings",
          },
          new AbortController().signal,
        );
        expect(sent.isError).not.toBe(true);
        return "I asked Reviewer to check it.";
      });
      workers.push(worker);
      return worker;
    },
  } as unknown as Computers;
  const { harness, bots, conversation, engines } =
    await runtimeFixture(computers);
  assert(engines?.collaboration);
  const collaboration = engines.collaboration;
  onTestFinished(async () => {
    await Promise.all(workers.map((worker) => worker.close()));
  });
  peerId = (
    await bots.create({ name: "Reviewer", requestId: "reviewer" }, context)
  ).id;
  const submission = await engines.submit(
    conversation.id,
    { text: "Ask Reviewer to check this", requestId: "ask-review" },
    context,
  );
  expect(await submission.wait(context)).toMatchObject({ status: "done" });
  await expect
    .poll(
      async () =>
        (await harness.snapshot(DelegationsDoc, context))?.items[0]?.reported,
    )
    .toBe(true);
  await expect
    .poll(async () =>
      (await engines.view(conversation.id, context)).messages
        .map((message) => JSON.stringify(message.content))
        .join("\n"),
    )
    .toContain("I received the review.");
  const item = (await harness.snapshot(DelegationsDoc, context))?.items[0];
  assert(item);
  expect(item).toMatchObject({
    sender: conversation.id,
    recipient: peerId,
    result: "Review found no issue.",
  });
  const privateChat = await bots.conversation(peerId, context);
  assert(privateChat);
  expect(
    (await privateChat.entries({}, 100, undefined, context)).items.filter(
      (entry) => entry.kind === EngineMessage,
    ),
  ).toHaveLength(0);
  expect(
    (await harness.snapshot(EngineDoc, item.session, context))?.sessionId,
  ).toBeTruthy();
  const profile = await bots.profile(peerId, context);
  const author = { botId: peerId, name: profile.name, avatar: profile.avatar };
  expect((await engines.view(item.session, context)).runs?.[0]).toMatchObject({
    sessionId: item.session,
    author,
  });
  await bots.update(
    peerId,
    { ...profile, name: "Renamed reviewer", requestId: "rename-reviewer" },
    context,
  );
  expect((await engines.view(item.session, context)).runs?.[0]?.author).toEqual(
    author,
  );
  await collaboration.finish(item.id, item.result, undefined, context);
  expect((await harness.snapshot(DelegationsDoc, context))?.items).toHaveLength(
    1,
  );
  expect(
    (await engines.view(conversation.id, context)).messages.filter(
      (message) => message.requestId === `delegation-result:${item.id}`,
    ),
  ).toHaveLength(1);
});

test.each(["cancel", "notify", "failure"])(
  "delegation %s retains results and does not resume cancelled work",
  async (mode) => {
    const workers: ProtocolProcess[] = [];
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let peerId = 0;
    let rootId = 0;
    let rootTurns = 0;
    const computers = {
      initialize: async () => {},
      attach: async () => {},
      preflight: async () => {},
      computerId: async () => "shared",
      binding: async () => ({ directory: null }),
      tools: { catalog: async () => [], finish: () => {} },
      process: async (
        id: number,
        _tools: unknown,
        invoke: Parameters<Computers["process"]>[2],
      ) => {
        const worker = featureProcess(async () => {
          if (id !== rootId) {
            started.resolve();
            await release.promise;
            return "Peer result";
          }
          rootTurns++;
          if (rootTurns === 1) {
            const result = await invoke(
              "send",
              "bot_send",
              {
                botId: peerId,
                task: "Check the shared file",
                reply: mode !== "notify",
              },
              new AbortController().signal,
            );
            expect(result.isError).not.toBe(true);
          }
          return "Owner turn complete";
        });
        workers.push(worker);
        return worker;
      },
    } as unknown as Computers;
    const fixture = await runtimeFixture(computers);
    const { harness, bots, conversation, engines } = fixture;
    assert(engines?.collaboration);
    const collaboration = engines.collaboration;
    rootId = conversation.id;
    peerId = (await bots.create({ name: "Peer", requestId: "peer" }, context))
      .id;
    onTestFinished(async () => {
      release.resolve();
      await Promise.all(workers.map((worker) => worker.close()));
    });
    await (
      await engines.submit(
        rootId,
        { text: "Delegate", requestId: "delegate" },
        context,
      )
    ).wait(context);
    await started.promise;
    const item = (await harness.snapshot(DelegationsDoc, context))?.items[0];
    assert(item);
    expect((await engines.view(rootId, context)).busy).toBe(true);
    if (mode === "cancel") {
      await engines.stop(rootId, context);
      release.resolve();
      await collaboration.finish(item.id, "Late result", undefined, context);
      expect(await collaboration.record(item.id, context)).toMatchObject({
        cancelled: true,
        result: "Late result",
      });
      await expect(
        engines.submit(
          rootId,
          { text: "Late", requestId: "late", delegationId: item.id },
          context,
        ),
      ).rejects.toThrow("取消");
    } else if (mode === "failure") {
      await engines.stop(item.session, context);
      release.resolve();
      await expect
        .poll(
          async () => (await collaboration.record(item.id, context)).reported,
        )
        .toBe(true);
      expect((await collaboration.record(item.id, context)).error).toBeTruthy();
    } else {
      release.resolve();
      await expect
        .poll(
          async () => (await collaboration.record(item.id, context)).endedAt,
        )
        .toBeTruthy();
      expect(rootTurns).toBe(1);
      expect(
        (await collaboration.record(item.id, context)).reported,
      ).toBeUndefined();
    }
    expect((await engines.view(peerId, context)).messages).toHaveLength(0);
  },
);

test("Pi delegates to Codex, queues behind private work and recovers a completed native result after restart", async () => {
  const workers: ProtocolProcess[] = [];
  const privateStarted = Promise.withResolvers<void>();
  const privateRelease = Promise.withResolvers<void>();
  const peerStarted = Promise.withResolvers<void>();
  let rootId = 0;
  let peerId = 0;
  let turns = 0;
  let rootTurns = 0;
  let recovered = false;
  const computers = {
    initialize: async () => {},
    attach: async () => {},
    preflight: async () => {},
    computerId: async () => "shared",
    binding: async () => ({ directory: null }),
    tools: { catalog: async () => [], finish: () => {} },
    process: async (
      id: number,
      _tools: unknown,
      invoke: Parameters<Computers["process"]>[2],
    ) => {
      if (id === rootId) {
        const worker = featureProcess(async () => {
          rootTurns++;
          if (rootTurns === 1) {
            const result = await invoke(
              "send",
              "bot_send",
              { botId: peerId, task: "Review changes" },
              new AbortController().signal,
            );
            expect(result.isError).not.toBe(true);
          }
          return rootTurns === 1 ? "Waiting for review" : "Review received";
        });
        workers.push(worker);
        return worker;
      }
      const worker = new ProtocolProcess();
      workers.push(worker);
      worker.receive = async (request) => {
        if (
          request.method === "thread/start" ||
          request.method === "thread/resume"
        )
          worker.response(request, { thread: { id: `thread-${id}` } });
        else if (request.method === "turn/start") {
          turns++;
          worker.response(request, { turn: { id: `turn-${id}` } });
          if (id === peerId) {
            privateStarted.resolve();
            await privateRelease.promise;
            worker.frame({
              method: "turn/completed",
              params: {
                threadId: `thread-${id}`,
                turn: { id: `turn-${id}`, status: "completed" },
              },
            });
          } else peerStarted.resolve();
        } else if (request.method === "thread/turns/list")
          worker.response(request, {
            data: [{ id: `turn-${id}`, status: "completed" }],
            nextCursor: null,
          });
        else if (request.method === "thread/items/list") {
          recovered = true;
          worker.response(request, {
            data: [
              {
                item: {
                  id: "review",
                  type: "agentMessage",
                  text: "Recovered review",
                },
              },
            ],
            nextCursor: null,
          });
        } else if (request.id !== undefined) worker.response(request, {});
      };
      return worker;
    },
  } as unknown as Computers;
  const fixture = await runtimeFixture(computers);
  let current: Awaited<ReturnType<typeof fixture.reopen>> = fixture;
  const engines = current.engines;
  assert(engines?.collaboration);
  rootId = current.conversation.id;
  peerId = (
    await current.bots.create(
      { name: "Codex reviewer", requestId: "codex-peer" },
      context,
    )
  ).id;
  await current.harness.commit(async (tx) => {
    (
      await tx.doc(
        EngineDoc,
        peerId as import("@earendil-works/pi-durable").ConversationId,
      )
    ).config = { provider: "codex", model: null };
  }, context);
  onTestFinished(async () => {
    privateRelease.resolve();
    await Promise.all(workers.map((worker) => worker.close()));
  });
  const privateTask = await engines.submit(
    peerId,
    { text: "Private task", requestId: "private" },
    context,
  );
  await privateStarted.promise;
  await (
    await engines.submit(
      rootId,
      { text: "Delegate", requestId: "delegate" },
      context,
    )
  ).wait(context);
  await expect
    .poll(
      async () =>
        (await current.harness.snapshot(DelegationsDoc, context))?.items.length,
    )
    .toBe(1);
  const item = (await current.harness.snapshot(DelegationsDoc, context))
    ?.items[0];
  assert(item);
  await expect
    .poll(
      async () =>
        (await current.harness.snapshot(EngineDoc, item.session, context))
          ?.tasks.length,
    )
    .toBe(1);
  expect(turns).toBe(1);
  expect(
    await engines.collaboration.status(item.source, item.id, context),
  ).toMatchObject([{ status: "queued" }]);
  privateRelease.resolve();
  await privateTask.wait(context);
  await peerStarted.promise;
  await expect
    .poll(
      async () =>
        (await current.harness.snapshot(EngineDoc, item.session, context))
          ?.dispatch,
    )
    .toBe("accepted");
  current = await fixture.reopen();
  const resumed = current.engines;
  assert(resumed?.collaboration);
  const resumedCollaboration = resumed.collaboration;
  await expect
    .poll(
      async () =>
        (await resumedCollaboration.record(item.id, context)).reported,
    )
    .toBe(true);
  expect(recovered).toBe(true);
  expect(turns).toBe(2);
  expect(
    (await resumedCollaboration.record(item.id, context)).result,
  ).toContain("Recovered review");
  expect(
    JSON.stringify((await resumed.view(peerId, context)).messages),
  ).not.toContain("Review changes");
});

test("nested delegation waits for its peer callback and shares only selected files", async () => {
  const workers: ProtocolProcess[] = [];
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let rootId = 0;
  let reviewerId = 0;
  let specialistId = 0;
  let sharedId = "";
  let ownerOf = async (id: number) => id;
  const turns = new Map<number, number>();
  const computers = {
    initialize: async () => {},
    attach: async () => {},
    preflight: async () => {},
    computerId: async () => "shared",
    binding: async () => ({ directory: null }),
    tools: { catalog: async () => [], finish: () => {} },
    process: async (
      id: number,
      _tools: unknown,
      invoke: Parameters<Computers["process"]>[2],
    ) => {
      const worker = featureProcess(async () => {
        const owner = await ownerOf(id);
        const turn = (turns.get(id) ?? 0) + 1;
        turns.set(id, turn);
        if (owner === specialistId) {
          started.resolve();
          await release.promise;
          return "Specialist confirmed the fix";
        }
        if (owner === reviewerId && turn > 1)
          return "Review complete with specialist evidence";
        if (owner === rootId && turn > 1) return "Final answer";
        const result = await invoke(
          "send",
          "bot_send",
          {
            botId: owner === rootId ? reviewerId : specialistId,
            task: "Verify the change",
            ...(owner === rootId ? { files: [sharedId] } : {}),
          },
          new AbortController().signal,
        );
        expect(result.isError).not.toBe(true);
        return "Waiting for peer";
      });
      workers.push(worker);
      return worker;
    },
  } as unknown as Computers;
  const { harness, bots, conversation, engines, files } =
    await runtimeFixture(computers);
  expect(engines).toBeDefined();
  assert(engines);
  rootId = conversation.id;
  reviewerId = (
    await bots.create({ name: "Reviewer", requestId: "reviewer" }, context)
  ).id;
  specialistId = (
    await bots.create({ name: "Specialist", requestId: "specialist" }, context)
  ).id;
  ownerOf = async (id) =>
    (await harness.snapshot(BotSession, id as typeof conversation.id, context))
      ?.botId ?? id;
  const shared = await files.upload(
    rootId,
    "brief.txt",
    new TextEncoder().encode("Shared task evidence"),
  );
  const privateFile = await files.upload(
    rootId,
    "private.txt",
    new TextEncoder().encode("Private material"),
  );
  sharedId = shared.id;
  onTestFinished(async () => {
    release.resolve();
    await Promise.all(workers.map((worker) => worker.close()));
  });
  await (
    await engines.submit(
      rootId,
      { text: "Review", requestId: "nested" },
      context,
    )
  ).wait(context);
  await started.promise;
  const items = (await harness.snapshot(DelegationsDoc, context))?.items;
  assert(items);
  const parent = items.find((item) => item.source === rootId);
  assert(parent);
  expect(parent.endedAt).toBeUndefined();
  const received = (
    await engines.view(parent.session, context)
  ).messages.flatMap((message) => message.attachments ?? []);
  expect(received).toHaveLength(1);
  const file = received[0];
  assert(file);
  expect(await (await files.download(reviewerId, file.id)).text()).toBe(
    "Shared task evidence",
  );
  await expect(files.download(reviewerId, privateFile.id)).rejects.toThrow();
  release.resolve();
  await expect
    .poll(
      async () =>
        (await engines.collaboration?.record(parent.id, context))?.reported,
    )
    .toBe(true);
  expect(
    (await engines.collaboration?.record(parent.id, context))?.result,
  ).toContain("Review complete with specialist evidence");
});
