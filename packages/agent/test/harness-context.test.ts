import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { EntryId } from "@earendil-works/pi-durable";
import { expect, test } from "vitest";
import { createBotSession } from "../src/conversations.ts";
import { conversationHandoff } from "../src/harness/handoff.ts";
import {
  conversationEntry,
  conversationHistory,
} from "../src/harness/history.ts";
import {
  callProductTool,
  recordToolResult,
} from "../src/harness/product-tools.ts";
import { EngineMessage } from "../src/harness/state.ts";
import type { EngineRuntime } from "../src/harness/task-types.ts";
import { Teams, TeamsDoc } from "../src/teams.ts";
import scenario from "./fixtures/harness-context.json" with { type: "json" };
import { runtimeFixture } from "./fixtures/runtime.ts";

test("long quoted messages retain file IDs independently of text excerpts", async () => {
  const runtime = await runtimeFixture();
  const id = runtime.conversation.id;
  const file = await runtime.files.upload(
    id,
    "note.txt",
    Buffer.from("source"),
    context,
  );
  await runtime.harness.commit(async (tx) => {
    await tx.appendEntry(id, {
      kind: EngineMessage,
      data: {
        id: "long-upload",
        role: "user",
        content: [{ type: "text", text: "中文".repeat(10000) }],
        attachments: [file],
      },
    });
  }, context);
  const packet = JSON.parse(
    await conversationHistory(
      {
        conversationId: id,
        commit: runtime.harness.commit.bind(runtime.harness),
      },
      null,
      context,
      null,
    ),
  );
  expect(packet.messages[0]).toMatchObject({
    conversationId: id,
    excerpt: true,
  });
  expect(packet.messages[0].omittedBytes).toBeGreaterThan(50000);
  expect(packet.messages[0].files[0]).toMatchObject({
    kind: "file",
    fileId: file.id,
    ownerBotId: id,
  });
  expect(Buffer.byteLength(JSON.stringify(packet))).toBeLessThanOrEqual(16000);
});

test("conversation_read recovers persisted tool text after reopen within its Bot", async () => {
  const fixture = await runtimeFixture();
  const text = `${"中文🙂".repeat(3000)}ORIGINAL-TAIL`;
  const source = {
    conversationId: fixture.conversation.id,
    taskId: 1,
    commit: fixture.harness.commit.bind(fixture.harness),
  } as EngineRuntime;
  const result = await recordToolResult(
    source,
    "original",
    "report",
    { content: [{ type: "text", text }] },
    context,
  );
  const entryId = result._meta?.["domos/result"];
  const reopened = await fixture.reopen();
  const reader = {
    conversationId: fixture.conversation.id,
    commit: reopened.harness.commit.bind(reopened.harness),
  } as EngineRuntime;
  let offset: number | null = 0;
  let full = "";
  while (offset !== null) {
    const response = await callProductTool(
      reader,
      "read",
      "conversation_read",
      { entryId, offset },
      context,
      new AbortController().signal,
    );
    const page = JSON.parse((response.content[0] as { text: string }).text);
    expect(page.text).not.toContain("�");
    full += page.text;
    offset = page.nextOffset;
  }
  const record = JSON.parse(full);
  expect(record.result.content[0].text).toBe(text);
  expect(record).toMatchObject({
    taskId: 1,
    callId: "original",
    name: "report",
  });
  const other = await reopened.bots.create(
    { name: "Other", requestId: crypto.randomUUID() },
    context,
  );
  await expect(
    callProductTool(
      { ...reader, conversationId: other.id },
      "read",
      "conversation_read",
      { entryId },
      context,
      new AbortController().signal,
    ),
  ).rejects.toThrow("不存在");
});

test("long handoffs reserve the opening request, corrections and recorded progress", async () => {
  const runtime = await runtimeFixture();
  const reader = {
    conversationId: runtime.conversation.id,
    commit: runtime.harness.commit.bind(runtime.harness),
  };
  let first!: EntryId;
  let planId!: EntryId;
  let checkId!: EntryId;
  await reader.commit(async (tx) => {
    for (let index = 0; index < 75; index++) {
      const entry = await tx.appendEntry(reader.conversationId, {
        kind: EngineMessage,
        data: {
          id: `history-${index}`,
          turnId: "source-turn",
          role: index % 2 ? "assistant" : "user",
          content: [
            {
              type: "text",
              text:
                index === 0
                  ? `${scenario.handoff.constraint} ${"earlier detail ".repeat(400)} ${scenario.longMessage.tail}`
                  : index === 74
                    ? scenario.handoff.correction
                    : `Checked item ${index}.`,
            },
          ],
        },
      });
      if (index === 0) first = entry.id;
    }
    planId = (
      await tx.appendEntry(reader.conversationId, {
        kind: EngineMessage,
        data: {
          id: "plan",
          role: "assistant",
          content: [],
          activity: {
            type: "plan",
            plan: [
              { step: "Implement A", status: "completed" },
              { step: "Implement B", status: "inProgress" },
              { step: "Implement C", status: "pending" },
            ],
          },
        },
      })
    ).id;
    checkId = (
      await tx.appendEntry(reader.conversationId, {
        kind: EngineMessage,
        data: {
          id: "check",
          role: "toolResult",
          toolName: "run_tests",
          toolStatus: "running",
          content: [{ type: "text", text: "test detail retained in Work" }],
        },
      })
    ).id;
  }, context);
  const result = await conversationHandoff(reader, null, context, null, 3000);
  const packet = JSON.parse(result.history);
  expect(packet.excerpt).toBe(true);
  expect(packet.messages[0]).toMatchObject({
    entryId: first,
    conversationId: reader.conversationId,
    turnId: "source-turn",
    excerpt: true,
  });
  expect(packet.omittedMessages).toBeGreaterThan(0);
  expect(packet.scanLimitReached).toBe(true);
  expect(result.history).toContain(scenario.handoff.constraint);
  expect(result.history).toContain(scenario.longMessage.tail);
  expect(result.history).toContain(scenario.handoff.correction);
  expect(packet.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        entryId: planId,
        text: expect.stringContaining("pending: Implement C"),
      }),
      expect.objectContaining({ entryId: checkId, text: "run_tests: running" }),
    ]),
  );
  expect(result.history).not.toContain("test detail retained in Work");
  expect(await conversationEntry(reader, checkId, 0, context)).toContain(
    "test detail retained in Work",
  );
  expect(await conversationEntry(reader, planId, 0, context)).toContain(
    "Implement B",
  );
  expect(result.notice).toContain("已交接聊天节选");
  expect(Buffer.byteLength(result.history)).toBeLessThanOrEqual(3000);
  expect(await conversationEntry(reader, first, 0, context)).toContain(
    "Do not install dependencies.",
  );
});

test("short history and confirmed native receipts preserve incremental chat", async () => {
  const runtime = await runtimeFixture();
  const reader = {
    conversationId: runtime.conversation.id,
    commit: runtime.harness.commit.bind(runtime.harness),
  };
  let first!: EntryId;
  await reader.commit(async (tx) => {
    first = (
      await tx.appendEntry(reader.conversationId, {
        kind: EngineMessage,
        data: {
          id: "early",
          role: "user",
          content: [{ type: "text", text: scenario.handoff.constraint }],
        },
      })
    ).id;
    await tx.appendEntry(reader.conversationId, {
      kind: EngineMessage,
      data: {
        id: "latest",
        role: "user",
        content: [{ type: "text", text: scenario.handoff.correction }],
      },
    });
  }, context);
  const fresh = await conversationHandoff(reader, null, context, null, 3000);
  expect(fresh.history).toContain(scenario.handoff.constraint);
  const resumed = await conversationHandoff(reader, null, context, first, 3000);
  expect(resumed.history).not.toContain(scenario.handoff.constraint);
  expect(resumed.history).toContain(scenario.handoff.correction);
});

test.each([true, false])(
  "saved native summaries retain their tail with newer messages: %s",
  async (newer) => {
    const runtime = await runtimeFixture();
    const reader = {
      conversationId: runtime.conversation.id,
      commit: runtime.harness.commit.bind(runtime.harness),
    };
    let through!: EntryId;
    await reader.commit(async (tx) => {
      for (let index = 0; index < 70; index++)
        through = (
          await tx.appendEntry(reader.conversationId, {
            kind: EngineMessage,
            data: {
              id: `old-${index}`,
              role: "assistant",
              content: [{ type: "text", text: `Checked ${index}` }],
            },
          })
        ).id;
      if (newer)
        await tx.appendEntry(reader.conversationId, {
          kind: EngineMessage,
          data: {
            id: "correction",
            role: "user",
            content: [{ type: "text", text: scenario.handoff.correction }],
          },
        });
    }, context);
    const saved = {
      text: scenario.handoff.constraint,
      through,
      nativeBoundary: "pi-native-kept",
      retained: [
        { role: "assistant" as const, text: scenario.handoff.unknown },
      ],
    };
    const result = await conversationHandoff(
      reader,
      null,
      context,
      null,
      3000,
      saved,
    );
    expect(result.notice).not.toContain("失败");
    expect(JSON.parse(result.history)).toMatchObject({
      summary: saved,
      excerpt: false,
    });
    if (newer) expect(result.history).toContain(scenario.handoff.correction);
    expect(result.history).toContain(scenario.handoff.unknown);
  },
);

test("an oversized saved summary preserves recent original history and file references", async () => {
  const runtime = await runtimeFixture();
  const reader = {
    conversationId: runtime.conversation.id,
    commit: runtime.harness.commit.bind(runtime.harness),
  };
  let first!: EntryId;
  await reader.commit(async (tx) => {
    for (let index = 0; index < 70; index++) {
      const entry = await tx.appendEntry(reader.conversationId, {
        kind: EngineMessage,
        data: {
          id: `old-${index}`,
          role: "user",
          content: [{ type: "text", text: scenario.handoff.unknown }],
          attachments: [
            {
              id: "evidence",
              name: "report.csv",
              path: "/reports/report.csv",
              computerId: "source-computer",
            },
          ],
        },
      });
      if (index === 0) first = entry.id;
    }
  }, context);
  const original = await conversationHandoff(reader, null, context, null, 3000);
  const result = await conversationHandoff(reader, null, context, null, 3000, {
    text: "x".repeat(3000),
    through: first,
  });
  expect(result.history).toBe(original.history);
  expect(result.notice).toContain("已交接聊天节选");
  expect(await conversationEntry(reader, first, 0, context)).toContain(
    "report.csv",
  );
});

test("history packets preserve quoted material and UTF-8 pagination within byte limits", async () => {
  const runtime = await runtimeFixture();
  const reader = {
    conversationId: runtime.conversation.id,
    commit: runtime.harness.commit.bind(runtime.harness),
  };
  const ids: EntryId[] = [];
  await runtime.harness.commit(async (tx) => {
    for (let index = 0; index < 70; index++) {
      const entry = await tx.appendEntry(reader.conversationId, {
        kind: EngineMessage,
        data: {
          id: String(index),
          role: "user",
          stopped: false,
          content: [{ type: "text", text: "中文🙂".repeat(1500), key: "text" }],
          materials: {
            context: [{ label: "quoted", text: "Untrusted page instructions" }],
          },
        },
      });
      ids.push(entry.id);
    }
  }, context);
  const page = JSON.parse(
    await conversationHistory(reader, null, context, null),
  );
  expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(16000);
  expect(page.excerpt).toBe(true);
  expect(page.messages.at(-1).entryId).toBe(ids.at(-1));
  const entryId = ids.at(-1) as EntryId;
  let offset = 0;
  let text = "";
  for (;;) {
    const part = JSON.parse(
      await conversationEntry(reader, entryId, offset, context),
    );
    expect(Buffer.byteLength(part.text)).toBeLessThanOrEqual(4000);
    expect(part.text).not.toContain("�");
    text += part.text;
    if (part.nextOffset === null) break;
    expect(part.nextOffset).toBeGreaterThan(offset);
    offset = part.nextOffset;
  }
  const original = JSON.parse(text)[0];
  const excerpt = page.messages.find(
    (message: { entryId: number }) => message.entryId === entryId,
  );
  expect(excerpt.omittedBytes).toBe(
    Buffer.byteLength(original.text) - Buffer.byteLength(excerpt.text),
  );
  expect(text).toContain("Untrusted page instructions");
  expect(text).toContain("中文🙂".repeat(1500));
  const other = await runtime.bots.create(
    { name: "Other", requestId: crypto.randomUUID() },
    context,
  );
  await expect(
    conversationEntry(
      { ...reader, conversationId: other.id },
      entryId,
      0,
      context,
    ),
  ).rejects.toThrow("不存在");
  await expect(conversationEntry(reader, entryId, -1, context)).rejects.toThrow(
    "偏移",
  );
});

test("handoffs select chat and bounded tool summaries while stored history stays complete", async () => {
  const runtime = await runtimeFixture();
  const reader = {
    conversationId: runtime.conversation.id,
    commit: runtime.harness.commit.bind(runtime.harness),
  };
  let boundary: EntryId | null = null;
  let resultId!: EntryId;
  await runtime.harness.commit(async (tx) => {
    boundary = (
      await tx.appendEntry(reader.conversationId, {
        kind: EngineMessage,
        data: {
          id: "request",
          role: "user",
          content: [{ type: "text", text: "Play the requested song" }],
        },
      })
    ).id;
    for (let index = 0; index < 25; index++) {
      await tx.appendEntry(reader.conversationId, {
        kind: EngineMessage,
        data: {
          id: `call-${index}`,
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: `c${index}`,
              name: "get_window_state",
              arguments: { window_id: 98765 },
            },
          ],
        },
      });
      resultId = (
        await tx.appendEntry(reader.conversationId, {
          kind: EngineMessage,
          data: {
            id: `result-${index}`,
            role: "toolResult",
            toolName: "get_window_state",
            toolCallId: `c${index}`,
            isError: index === 24,
            content: [
              {
                type: "text",
                text: "snapshot old-token remains valid; window_id=98765",
              },
            ],
          },
        })
      ).id;
    }
    await tx.appendEntry(reader.conversationId, {
      kind: EngineMessage,
      data: {
        id: "answer",
        role: "assistant",
        content: [{ type: "text", text: "Playback was confirmed" }],
      },
    });
  }, context);
  const handoff = await conversationHistory(
    reader,
    null,
    context,
    null,
    undefined,
    16000,
    "omit",
  );
  expect(handoff).toContain("Play the requested song");
  expect(handoff).toContain("Playback was confirmed");
  expect(handoff).not.toMatch(/98765|old-token|toolCall|toolResult/);
  const resumed = await conversationHistory(
    reader,
    null,
    context,
    boundary,
    undefined,
    16000,
    "omit",
  );
  expect(resumed).not.toContain("Play the requested song");
  expect(resumed).toContain("Playback was confirmed");
  const summary = JSON.parse(
    await conversationHistory(
      reader,
      null,
      context,
      null,
      undefined,
      16000,
      "summary",
    ),
  );
  const tools = summary.messages.filter(
    (item: { role: string }) => item.role === "toolResult",
  );
  expect(tools).toHaveLength(20);
  expect(tools.every((item: { text: string }) => item.text.length <= 120)).toBe(
    true,
  );
  expect(tools.at(-1).text).toBe("get_window_state: failed");
  expect(JSON.stringify(summary)).not.toMatch(/98765|old-token/);
  const full = await conversationEntry(reader, resultId, 0, context);
  expect(full).toContain("old-token remains valid");
});

test("history search scopes pages before limiting and retains original evidence after reopen", async () => {
  const fixture = await runtimeFixture();
  const id = fixture.conversation.id;
  const other = await fixture.bots.create(
    { name: "Other", requestId: crypto.randomUUID() },
    context,
  );
  await fixture.harness.commit(async (tx) => {
    for (const conversationId of [id, other.id])
      for (let index = 0; index < 70; index++)
        await tx.appendEntry(conversationId, {
          kind: EngineMessage,
          data: {
            id: `search:${index}`,
            turnId: `turn:${index}`,
            role: "user",
            content: [
              { type: "text", text: `发布记录 ${index} release 100%_ready` },
            ],
            timestamp: 1000 + index,
          },
        });
  }, context);
  const source = {
    conversationId: id,
    taskId: 1,
    commit: fixture.harness.commit.bind(fixture.harness),
  } as EngineRuntime;
  const archived = await recordToolResult(
    source,
    "check",
    "run_tests",
    { content: [{ type: "text", text: "Original execution evidence" }] },
    context,
  );
  const restored = await fixture.reopen();
  const reader = {
    conversationId: id,
    commit: restored.harness.commit.bind(restored.harness),
  } as EngineRuntime;
  const read = async (
    args: Record<string, unknown>,
    signal = new AbortController().signal,
  ) => {
    const result = await callProductTool(
      reader,
      "read",
      "conversation_read",
      args,
      context,
      signal,
      restored.bots.chats,
    );
    return JSON.parse((result.content[0] as { text: string }).text);
  };
  const page = await read({ query: "发布记录" });
  expect(page.items).toHaveLength(50);
  expect(
    page.items.every(
      (item: { conversationId: number }) => item.conversationId === id,
    ),
  ).toBe(true);
  const older = await read({ query: "发布记录", before: page.before });
  expect(older.items).toHaveLength(20);
  const earliest = older.items.at(-1);
  expect(earliest).toMatchObject({
    turnId: "turn:0",
    timestamp: 1000,
    excerpt: "发布记录 0 release 100%_ready",
  });
  expect(
    JSON.parse((await read({ entryId: earliest.entryId })).text)[0].text,
  ).toBe(earliest.excerpt);
  expect((await read({ query: "RELEASE 100%_ready" })).items).toHaveLength(50);
  expect((await read({ query: "not recorded" })).items).toEqual([]);
  const evidence = (await read({})).messages.find(
    (message: { tool?: string }) => message.tool === "run_tests",
  );
  expect(evidence).toMatchObject({
    entryId: archived._meta?.["domos/result"],
    taskId: 1,
    conversationId: id,
  });
  expect(
    JSON.parse((await read({ entryId: evidence.entryId })).text).result
      .content[0].text,
  ).toBe("Original execution evidence");
  for (const args of [
    { query: " " },
    { query: "x".repeat(201) },
    { query: 2 },
    { query: "x", entryId: 1 },
    { query: "x", offset: 0 },
    { query: "x", before: -1 },
    { query: "x", botId: other.id },
  ])
    await expect(read(args)).rejects.toThrow("无效");
  const stopped = new AbortController();
  stopped.abort(new Error("Stopped"));
  await expect(read({ query: "发布记录" }, stopped.signal)).rejects.toThrow(
    "Stopped",
  );
});

test("Bot history permits team chat while private, delegated and hidden records stay isolated", async () => {
  const runtime = await runtimeFixture();
  const owner = runtime.conversation.id;
  const peer = await runtime.bots.create(
    { name: "Peer", requestId: crypto.randomUUID() },
    context,
  );
  const teams = new Teams(runtime.harness);
  await teams.create(
    {
      id: "release",
      name: "Release",
      purpose: "Review",
      owner,
      members: [owner, peer.id],
    },
    context,
  );
  const team = await teams.session("release", owner, context);
  const peerTeam = await teams.session("release", peer.id, context);
  const delegated = await createBotSession(
    runtime.harness,
    owner,
    { purpose: "delegation", origin: owner },
    context,
  );
  const teamDelegated = await createBotSession(
    runtime.harness,
    owner,
    { purpose: "delegation", teamId: "release", origin: owner },
    context,
  );
  const entries: EntryId[] = [];
  await runtime.harness.commit(async (tx) => {
    for (const conversationId of [
      owner,
      peer.id,
      team,
      peerTeam,
      delegated,
      teamDelegated,
    ]) {
      entries.push(
        (
          await tx.appendEntry(conversationId, {
            kind: EngineMessage,
            data: {
              id: `record:${conversationId}`,
              role: "assistant",
              content: [{ type: "text", text: "Shared needle" }],
            },
          })
        ).id,
      );
    }
    const privateRecords: Record<string, string | boolean>[] = [
      { hidden: true },
      { parentId: "delegated" },
      { pending: true },
      { role: "toolResult" },
    ];
    for (const fields of privateRecords) {
      entries.push(
        (
          await tx.appendEntry(peerTeam, {
            kind: EngineMessage,
            data: {
              id: crypto.randomUUID(),
              role: "assistant",
              content: [{ type: "text", text: "Hidden needle" }],
              ...fields,
            },
          })
        ).id,
      );
    }
  }, context);
  const read = async (
    conversationId: typeof owner,
    args: Record<string, unknown>,
  ) => {
    const result = await callProductTool(
      {
        conversationId,
        commit: runtime.harness.commit.bind(runtime.harness),
      } as EngineRuntime,
      "read",
      "conversation_read",
      args,
      context,
      new AbortController().signal,
      runtime.bots.chats,
    );
    return JSON.parse((result.content[0] as { text: string }).text);
  };
  const privateChat = await runtime.bots.createSession(
    owner,
    owner,
    crypto.randomUUID(),
    context,
  );
  const privateEntry = await runtime.harness.commit(
    async (tx) =>
      (
        await tx.appendEntry(privateChat, {
          kind: EngineMessage,
          data: {
            id: "private-note",
            role: "user",
            content: [{ type: "text", text: "Private needle" }],
          },
        })
      ).id,
    context,
  );
  expect(
    (await read(owner, { query: "needle" })).items
      .map((item: { conversationId: number }) => item.conversationId)
      .sort(),
  ).toEqual([owner, team, peerTeam, privateChat].sort());
  expect(
    JSON.parse((await read(privateChat, { entryId: entries[0] })).text)[0],
  ).toMatchObject({ conversationId: owner });
  await expect(read(team, { entryId: privateEntry })).rejects.toThrow("不存在");
  await expect(read(peer.id, { entryId: privateEntry })).rejects.toThrow(
    "不存在",
  );
  expect(
    (await read(team, { query: "needle" })).items
      .map((item: { conversationId: number }) => item.conversationId)
      .sort(),
  ).toEqual([team, peerTeam].sort());
  expect((await read(delegated, { query: "needle" })).items).toEqual([]);
  expect(
    JSON.parse((await read(owner, { entryId: entries[3] })).text)[0],
  ).toMatchObject({
    conversationId: peerTeam,
    author: { botId: peer.id, name: "Peer" },
  });
  for (const entryId of [entries[1], entries[4], ...entries.slice(5)])
    await expect(read(owner, { entryId })).rejects.toThrow("不存在");
  await expect(read(team, { entryId: entries[0] })).rejects.toThrow("不存在");
  await runtime.harness.commit(async (tx) => {
    const saved = (await tx.doc(TeamsDoc)).items[0];
    if (!saved) throw new Error("Team required");
    saved.members = [peer.id];
  }, context);
  expect(
    (await read(owner, { query: "needle" })).items.map(
      (item: { conversationId: number }) => item.conversationId,
    ),
  ).toEqual([privateChat, owner]);
  await expect(read(owner, { entryId: entries[3] })).rejects.toThrow("不存在");
  expect(
    (await read(team, { query: "needle" })).items.map(
      (item: { conversationId: number }) => item.conversationId,
    ),
  ).toEqual([team]);
  await expect(read(team, { entryId: entries[3] })).rejects.toThrow("不存在");
});
