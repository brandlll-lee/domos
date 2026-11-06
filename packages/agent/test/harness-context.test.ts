import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { EntryId } from "@earendil-works/pi-durable";
import { expect, test } from "vitest";
import { conversationHandoff } from "../src/harness/handoff.ts";
import {
  conversationEntry,
  conversationHistory,
} from "../src/harness/history.ts";
import { EngineMessage } from "../src/harness/state.ts";
import scenario from "./fixtures/harness-context.json" with { type: "json" };
import { runtimeFixture } from "./fixtures/runtime.ts";

test("long handoffs retain early constraints and later corrections without changing source history", async () => {
  const runtime = await runtimeFixture();
  const reader = {
    conversationId: runtime.conversation.id,
    commit: runtime.harness.commit.bind(runtime.harness),
  };
  let first!: EntryId;
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
  }, context);
  const calls: string[] = [];
  const result = await conversationHandoff(
    reader,
    null,
    context,
    null,
    3000,
    undefined,
    async (text) => {
      calls.push(text);
      return "Goal: review report.csv. Constraint: do not install dependencies. Deployment was cancelled. Next: review only.";
    },
  );
  expect(calls.join("\n")).toContain("Do not install dependencies.");
  expect(calls.join("\n")).toContain(scenario.longMessage.tail);
  expect(result.history).toContain("do not install dependencies");
  expect(result.history).toContain("Cancel deployment. Review only.");
  expect(result.summary?.through).toBeGreaterThan(first);
  expect(Buffer.byteLength(result.history)).toBeLessThanOrEqual(3000);
  expect(await conversationEntry(reader, first, 0, context)).toContain(
    "Do not install dependencies.",
  );
});

test("short history and confirmed native receipts do not request summaries", async () => {
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
  let calls = 0;
  const summarize = async () => {
    calls++;
    return "summary";
  };
  const fresh = await conversationHandoff(
    reader,
    null,
    context,
    null,
    3000,
    undefined,
    summarize,
  );
  expect(fresh.history).toContain(scenario.handoff.constraint);
  const resumed = await conversationHandoff(
    reader,
    null,
    context,
    first,
    3000,
    undefined,
    summarize,
  );
  expect(resumed.history).not.toContain(scenario.handoff.constraint);
  expect(resumed.history).toContain(scenario.handoff.correction);
  expect(calls).toBe(0);
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
      async () => {
        throw new Error("Summary must be reused");
      },
    );
    expect(result.notice).not.toContain("失败");
    expect(JSON.parse(result.history)).toMatchObject({
      summary: saved,
      excerpt: false,
    });
    if (newer) expect(result.history).toContain(scenario.handoff.correction);
    expect(result.history).toContain(scenario.handoff.unknown);
    expect(result.summary).toBeUndefined();
  },
);

test.each(["unavailable", "oversized"])(
  "failed summary (%s) preserves original history and quoted file references",
  async (failure) => {
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
    const original = await conversationHistory(
      reader,
      null,
      context,
      null,
      undefined,
      3000,
      "omit",
    );
    const calls: string[] = [];
    const result = await conversationHandoff(
      reader,
      null,
      context,
      null,
      3000,
      undefined,
      async (text) => {
        calls.push(text);
        if (failure === "unavailable") throw new Error("quota exhausted");
        return "x".repeat(3000);
      },
    );
    expect(calls[0]).toContain("source-computer");
    expect(calls[0]).toContain(scenario.handoff.unknown);
    expect(result.history).toBe(original);
    expect(result.summary).toBeUndefined();
    expect(result.notice).toContain("失败");
    expect(await conversationEntry(reader, first, 0, context)).toContain(
      "report.csv",
    );
  },
);

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
