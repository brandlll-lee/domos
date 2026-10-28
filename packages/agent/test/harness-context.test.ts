import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { EntryId } from "@earendil-works/pi-durable";
import { expect, test } from "vitest";
import {
  conversationEntry,
  conversationHistory,
} from "../src/harness/history.ts";
import { EngineMessage } from "../src/harness/state.ts";
import { runtimeFixture } from "./fixtures/runtime.ts";

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
