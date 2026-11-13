import assert from "node:assert/strict";
import { expect, test } from "vitest";
import { ComputerRequests } from "../src/computer/runtime.ts";
import { createBotSession } from "../src/conversations.ts";
import { EngineDoc, EngineMessage } from "../src/harness/state.ts";
import { Teams, TeamsDoc } from "../src/teams.ts";
import { RoutinesDoc } from "../src/work/routine-state.ts";
import { context, setup } from "./fixtures/work.ts";

test("history search crosses stored pages and receipts count only published incoming messages", async () => {
  const fixture = await setup();
  const runtime = await fixture.open();
  const bot = (await runtime.bots.list(context))[0];
  assert(bot);
  let cursor = "";
  try {
    await runtime.harness.commit(async (tx) => {
      for (let index = 0; index < 430; index++) {
        const entry = await tx.appendEntry(bot.id, {
          kind: EngineMessage,
          data: {
            id: `message:${index}`,
            role: index % 2 ? "assistant" : "user",
            stopped: false,
            content: [
              {
                type: "text",
                key: String(index),
                text: `报告 ${index}：历史关键词 release 100%`,
              },
            ],
            timestamp: 1000 + index,
          },
        });
        if (index === 101) cursor = `${entry.id}:0`;
      }
      await tx.appendEntry(bot.id, {
        kind: EngineMessage,
        data: {
          id: "tool",
          role: "toolResult",
          stopped: false,
          content: [
            { type: "text", key: "secret", text: "hidden tool payload" },
          ],
        },
      });
      await tx.appendEntry(bot.id, {
        kind: EngineMessage,
        data: {
          id: "reasoning",
          role: "assistant",
          stopped: false,
          content: [
            {
              type: "thinking",
              key: "reasoning",
              thinking: "hidden reasoning",
            },
          ],
        },
      });
    }, context);
    const page = await runtime.bots.chats.search(
      "历史关键词",
      undefined,
      context,
    );
    expect(page.items).toHaveLength(50);
    expect(page.items[0]?.messageId).toBe("message:429");
    const next = await runtime.bots.chats.search(
      "历史关键词",
      page.before,
      context,
    );
    expect(next.items[0]?.messageId).toBe("message:379");
    expect(
      new Set([...page.items, ...next.items].map((item) => item.messageId))
        .size,
    ).toBe(100);
    expect(
      (await runtime.bots.chats.search("报告 101：", undefined, context))
        .items[0],
    ).toMatchObject({ cursor, messageId: "message:101", author: bot.name });
    expect(
      (await runtime.bots.chats.search("100%", undefined, context)).items,
    ).toHaveLength(50);
    expect(
      (await runtime.bots.chats.search("hidden", undefined, context)).items,
    ).toHaveLength(0);
    const chat = `bot/${bot.id}`;
    expect((await runtime.bots.chats.summary({}, context)).counts[chat]).toBe(
      215,
    );
    const receipt = await runtime.bots.chats.receipts(
      chat,
      [{ sessionId: bot.id, messageId: "message:101" }],
      context,
    );
    expect(
      (await runtime.bots.chats.summary(receipt, context)).counts[chat],
    ).toBe(164);
    expect(
      await runtime.bots.chats.receipts(
        "team/other",
        [{ sessionId: bot.id, messageId: "message:429" }],
        context,
      ),
    ).toEqual({});
  } finally {
    await runtime.harness.close(context);
  }
  const restored = await fixture.open();
  try {
    expect(
      (await restored.bots.chats.summary({}, context)).counts[`bot/${bot.id}`],
    ).toBe(215);
    expect(
      (await restored.bots.chats.search("报告 101：", undefined, context))
        .items[0]?.cursor,
    ).toBe(cursor);
  } finally {
    await restored.harness.close(context);
  }
});

test("team search preserves authors and removed members' history and excludes delegated sessions", async () => {
  const fixture = await setup();
  const runtime = await fixture.open();
  try {
    const owner = (await runtime.bots.list(context))[0];
    assert(owner);
    const peer = await runtime.bots.create(
      { name: "Reviewer", requestId: crypto.randomUUID() },
      context,
    );
    const teams = new Teams(runtime.harness);
    await teams.create(
      {
        id: "release",
        name: "发布小队",
        purpose: "Review",
        owner: owner.id,
        members: [owner.id, peer.id],
      },
      context,
    );
    const session = await teams.session("release", peer.id, context);
    const ownerSession = await teams.session("release", owner.id, context);
    const delegated = await createBotSession(
      runtime.harness,
      peer.id,
      { purpose: "delegation", origin: owner.id },
      context,
    );
    await runtime.harness.commit(async (tx) => {
      for (const id of [owner.id, session, delegated])
        await tx.appendEntry(id, {
          kind: EngineMessage,
          data: {
            id: `result:${id}`,
            role: "assistant",
            stopped: false,
            content: [{ type: "text", key: "result", text: "共同关键词" }],
          },
        });
    }, context);
    const results = await runtime.bots.chats.search(
      "共同关键词",
      undefined,
      context,
    );
    expect(results.items).toHaveLength(2);
    expect(
      results.items.find((item) => item.sessionId === session),
    ).toMatchObject({
      name: "发布小队",
      author: "Reviewer",
      chat: "team/release",
    });
    expect(
      (await runtime.bots.chats.summary({}, context)).counts,
    ).toMatchObject({ [`bot/${owner.id}`]: 1, "team/release": 1 });
    await runtime.harness.commit(async (tx) => {
      await tx.appendEntry(ownerSession, {
        kind: EngineMessage,
        data: {
          id: "owner-result",
          role: "assistant",
          stopped: false,
          content: [{ type: "text", key: "result", text: "负责人处理完成" }],
        },
      });
    }, context);
    const read = await runtime.bots.chats.receipts(
      "team/release",
      [{ sessionId: ownerSession, messageId: "owner-result" }],
      context,
    );
    expect(
      (await runtime.bots.chats.summary(read, context)).counts["team/release"],
    ).toBe(1);
    await runtime.harness.commit(async (tx) => {
      const team = (await tx.doc(TeamsDoc)).items[0];
      assert(team);
      team.members = [owner.id];
    }, context);
    expect(
      (await runtime.bots.chats.search("共同关键词", undefined, context)).items,
    ).toHaveLength(2);
    expect(
      (await runtime.bots.chats.summary({}, context)).counts["team/release"],
    ).toBe(2);
  } finally {
    await runtime.harness.close(context);
  }
});

test("quiet routine results remain outside search, unread and completion alerts", async () => {
  const fixture = await setup();
  const runtime = await fixture.open();
  const bot = (await runtime.bots.list(context))[0];
  assert(bot);
  try {
    await runtime.harness.commit(async (tx) => {
      (await tx.doc(RoutinesDoc)).runs.push({
        id: "watch",
        routineId: "watch",
        botId: bot.id,
        title: "监测",
        mode: "scheduled",
        scheduledAt: 1,
        firedAt: 1,
        finishedAt: 2,
        coalesced: false,
        status: "done",
        error: null,
        content: "",
        requestId: "watch",
        submissionId: null,
        turnId: "quiet",
        delivery: "conditional",
        delivered: false,
      });
      await tx.appendEntry(bot.id, {
        kind: EngineMessage,
        data: {
          id: "quiet-result",
          turnId: "quiet",
          role: "assistant",
          stopped: false,
          content: [{ type: "text", key: "quiet", text: "未触发监测条件" }],
        },
      });
      (await tx.doc(EngineDoc, bot.id)).run = {
        turnId: "quiet",
        provider: "pi",
        model: null,
        status: "ended",
        startedAt: 1,
        endedAt: 2,
      };
    }, context);
    expect(
      (await runtime.bots.chats.search("监测", undefined, context)).items,
    ).toEqual([]);
    expect(await runtime.bots.chats.summary({}, context)).toMatchObject({
      counts: { [`bot/${bot.id}`]: 0 },
      events: [],
    });
  } finally {
    await runtime.harness.close(context);
  }
});

test("attention keeps request identity and terminal work separate from ordinary progress", async () => {
  const fixture = await setup();
  const runtime = await fixture.open();
  const bot = (await runtime.bots.list(context))[0];
  assert(bot);
  try {
    expect((await runtime.bots.chats.summary({}, context)).events).toEqual([]);
    await runtime.harness.commit(async (tx) => {
      (await tx.doc(ComputerRequests, bot.id)).approvals = [
        {
          id: "confirm",
          title: "发送报告",
          detail: "Review",
          kind: "permission",
          requestedAt: 1200,
        },
      ];
      (await tx.doc(EngineDoc, bot.id)).run = {
        turnId: "turn",
        provider: "pi",
        model: null,
        status: "running",
        startedAt: 1000,
      };
    }, context);
    const waiting = await runtime.bots.chats.summary({}, context);
    expect(waiting.events).toHaveLength(1);
    expect(waiting.events[0]).toMatchObject({
      kind: "approval",
      text: "需要你确认：发送报告",
      messageId: "approval:confirm:1200",
    });
    await runtime.harness.commit(async (tx) => {
      (await tx.doc(ComputerRequests, bot.id)).approvals = [];
      const run = (await tx.doc(EngineDoc, bot.id)).run;
      assert(run);
      run.status = "failed";
    }, context);
    const failed = await runtime.bots.chats.summary({}, context);
    expect(failed.events).toHaveLength(2);
    expect(failed.events[1]).toMatchObject({
      kind: "failed",
      messageId: "failure:turn",
      turnId: "turn",
    });
    expect((await runtime.bots.chats.summary({}, context)).events).toEqual(
      failed.events,
    );
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      runtime.bots.chats.search("报告", undefined, {
        ...context,
        abortSignal: aborted.signal,
      }),
    ).rejects.toThrow();
  } finally {
    await runtime.harness.close(context);
  }
});
