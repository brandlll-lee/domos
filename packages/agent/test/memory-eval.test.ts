import { expect, test } from "vitest";
import { evaluateMemory, type MemoryTrial } from "../src/evals/memory-score.ts";

test("memory trajectory rules detect overwrite, forged provenance and private leaks", () => {
  const trial: MemoryTrial = {
    id: "manual",
    answer: "报告使用中文",
    memories: [
      {
        id: "seed",
        botId: 1,
        text: "报告必须使用中文。",
        revision: 1,
        updatedAt: 1,
        source: "user",
        requestId: "seed",
      },
    ],
    calls: [],
    sourceIds: [10],
    privateMarker: "私有代号-926",
  };
  expect(evaluateMemory(trial)).toMatchObject({
    passed: 3,
    total: 3,
    answerReview: "unreviewed",
  });
  const corrupted = {
    ...trial,
    answer: trial.privateMarker,
    memories: trial.memories.map((item) => ({
      ...item,
      text: "报告使用英文",
      evidence: [{ conversationId: 2, entryId: 99, quote: "伪造" }],
    })),
  };
  expect(evaluateMemory(corrupted)).toMatchObject({ passed: 0, total: 3 });
});

test("city trajectory requires the original memory ID and a newer revision", () => {
  const trial: MemoryTrial = {
    id: "city",
    answer: "现在住上海，去年住北京。",
    memories: [
      {
        id: "seed",
        botId: 1,
        text: "用户住在上海。",
        revision: 2,
        updatedAt: 2,
        source: "bot:1",
        requestId: "update",
        origin: "user",
        evidence: [{ conversationId: 1, entryId: 10, quote: "我现在住上海" }],
      },
    ],
    calls: [
      {
        name: "conversation_read",
        input: { entryId: 9 },
        output: "我去年住北京",
        isError: false,
      },
    ],
    sourceIds: [9, 10],
    privateMarker: "私有代号-926",
  };
  expect(evaluateMemory(trial)).toMatchObject({ passed: 6, total: 6 });
  for (const changed of [{ id: "new-city" }, { revision: 1 }]) {
    expect(
      evaluateMemory({
        ...trial,
        memories: trial.memories.map((item) => ({ ...item, ...changed })),
      }),
    ).toMatchObject({ passed: 5, total: 6, rules: { inPlaceUpdate: false } });
  }
});
