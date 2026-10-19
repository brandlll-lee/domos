import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { expect, test } from "vitest";
import { FileInput } from "../src/files.ts";
import { EngineMessage } from "../src/harness/state.ts";
import { context, setup } from "./fixtures/work.ts";

test("directory previews follow committed messages and survive reopening", async () => {
  const fixture = await setup();
  const runtime = await fixture.open();
  const bot = await runtime.bots.create(
    {
      name: "Reviewer",
      instructions: "Review release changes.",
      requestId: crypto.randomUUID(),
    },
    context,
  );
  const events = runtime.bots.watch(context);
  const createdAt = bot.createdAt;
  expect(createdAt).toEqual(expect.any(Number));
  try {
    expect((await events.next()).value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: bot.id,
          preview: "Review release changes.",
        }),
      ]),
    );
    const conversation = await runtime.bots.conversation(bot.id, context);
    await conversation?.configure(
      { instructions: "Check facts and sources." },
      context,
    );
    expect((await events.next()).value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: bot.id,
          preview: "Check facts and sources.",
        }),
      ]),
    );
    await runtime.harness.commit(async (tx) => {
      await tx.appendEntry(bot.id, {
        kind: crypto.randomUUID(),
        model: [
          { role: "user", content: "Check the release", timestamp: Date.now() },
        ],
      });
    }, context);
    expect((await events.next()).value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: bot.id, preview: "Check the release" }),
      ]),
    );
    await runtime.harness.commit(async (tx) => {
      await tx.appendEntry(bot.id, {
        kind: crypto.randomUUID(),
        model: [fauxAssistantMessage("**Release** checked.")],
      });
      for (let index = 0; index < 80; index++)
        await tx.appendEntry(bot.id, {
          kind: crypto.randomUUID(),
          data: { index },
        });
    }, context);
    expect((await events.next()).value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: bot.id,
          preview: "Release checked.",
          createdAt,
        }),
      ]),
    );
  } finally {
    await events.return();
    await runtime.harness.close(context);
  }
  const restored = await fixture.open();
  try {
    expect(await restored.bots.list(context)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: bot.id, preview: "Release checked." }),
      ]),
    );
  } finally {
    await restored.harness.close(context);
  }
});

test("directory previews use displayed input and delivered text", async () => {
  const fixture = await setup();
  const runtime = await fixture.open();
  const id = runtime.conversation.id;
  const preview = async () =>
    (await runtime.bots.list(context)).find((item) => item.id === id)?.preview;
  try {
    await runtime.harness.commit(async (tx) => {
      await tx.appendEntry(id, {
        kind: FileInput,
        data: { text: "Read **this** attachment", attachments: [] },
        model: [
          {
            role: "user",
            content: "Internal workspace context",
            timestamp: Date.now(),
          },
        ],
      });
    }, context);
    expect(await preview()).toBe("Read **this** attachment");
    await runtime.harness.commit(async (tx) => {
      await tx.appendEntry(id, {
        kind: crypto.randomUUID(),
        model: [
          fauxAssistantMessage("An incomplete draft", {
            stopReason: "aborted",
          }),
        ],
      });
    }, context);
    expect(await preview()).toBe("Read **this** attachment");
    await runtime.harness.commit(async (tx) => {
      await tx.appendEntry(id, {
        kind: crypto.randomUUID(),
        model: [
          {
            role: "toolResult",
            toolCallId: crypto.randomUUID(),
            toolName: crypto.randomUUID(),
            content: [{ type: "text", text: "Tool bookkeeping" }],
            isError: false,
            timestamp: Date.now(),
            details: { delivery: { text: "Your **file** is ready." } },
          },
        ],
      });
    }, context);
    expect(await preview()).toBe("Your file is ready.");
    await runtime.harness.commit(async (tx) => {
      await tx.appendEntry(id, {
        kind: EngineMessage,
        data: {
          role: "assistant",
          content: [
            { type: "text", text: "[Report](https://example.com) ready." },
          ],
        },
      });
    }, context);
    expect(await preview()).toBe("Report ready.");
    await runtime.harness.commit(async (tx) => {
      await tx.appendEntry(id, {
        kind: EngineMessage,
        data: {
          role: "user",
          content: "Keep **these** characters.",
        },
      });
    }, context);
    expect(await preview()).toBe("Keep **these** characters.");
    await runtime.harness.commit(async (tx) => {
      await tx.appendEntry(id, {
        kind: crypto.randomUUID(),
        data: { diagnostics: [{ code: "aborted" }] },
        model: [
          {
            role: "toolResult",
            toolCallId: crypto.randomUUID(),
            toolName: crypto.randomUUID(),
            content: [],
            isError: false,
            timestamp: Date.now(),
            details: { delivery: { text: "Cancelled output" } },
          },
        ],
      });
    }, context);
    expect(await preview()).toBe("Keep **these** characters.");
  } finally {
    await runtime.harness.close(context);
  }
});
