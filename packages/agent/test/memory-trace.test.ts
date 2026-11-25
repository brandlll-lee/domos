import { expect, test } from "vitest";
import { memoryCases } from "../src/evals/memory-cases.ts";
import { readMemoryTrace } from "../src/evals/memory-trace.ts";
import { EngineMessage } from "../src/harness/state.ts";
import { context, setup } from "./fixtures/work.ts";

test("memory traces retain paged sources and associate each question with its own answer", async () => {
  const f = await setup();
  const runtime = await f.open();
  try {
    const botId = runtime.conversation.id;
    await runtime.harness.commit(async (tx) => {
      for (let index = 0; index < 505; index++)
        await tx.appendEntry(botId, {
          kind: EngineMessage,
          data: {
            id: `source:${index}`,
            role: "user",
            content: [{ type: "text", text: `source ${index}` }],
          },
        });
      for (const [index, text] of memoryCases[0].prompts.entries()) {
        await tx.appendEntry(botId, {
          kind: EngineMessage,
          data: {
            id: `question:${index}`,
            role: "user",
            turnId: `turn:${index}`,
            requestId: `eval:city:${index}`,
            content: [{ type: "text", text }],
          },
        });
        await tx.appendEntry(botId, {
          kind: EngineMessage,
          data: {
            id: `answer:${index}`,
            role: "assistant",
            turnId: `turn:${index}`,
            pending: false,
            content: [{ type: "text", text: `answer ${index}` }],
          },
        });
      }
    }, context);
    const trace = await readMemoryTrace(runtime.conversation, "city", context);
    expect(trace.sourceIds).toHaveLength(509);
    expect(trace.answers).toMatchObject([
      {
        prompt: memoryCases[0].prompts[0],
        requestId: "eval:city:0",
        turnId: "turn:0",
        completion: "unreviewed",
        messages: [{ messageId: "answer:0", text: "answer 0" }],
      },
      {
        prompt: memoryCases[0].prompts[1],
        requestId: "eval:city:1",
        turnId: "turn:1",
        completion: "unreviewed",
        messages: [{ messageId: "answer:1", text: "answer 1" }],
      },
    ]);
    expect(trace.answers[1]?.messages[0]?.entryId).toBe(trace.sourceIds.at(-1));
  } finally {
    await runtime.harness.close(context);
  }
});
