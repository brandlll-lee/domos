import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { EntryId } from "@earendil-works/pi-durable";
import { expect, test } from "vitest";
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
  expect(packet.messages[0].excerpt).toBe(true);
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
  expect(packet.messages[0]).toMatchObject({ entryId: first, excerpt: true });
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
