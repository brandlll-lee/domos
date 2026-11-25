import { z } from "zod";
import { memoryCases } from "./memory-cases.ts";

const memoryTrial = z.looseObject({
  id: z.enum(memoryCases.map((item) => item.id)),
  answer: z.string(),
  memories: z.array(
    z.looseObject({
      id: z.string(),
      text: z.string(),
      revision: z.number().int().nonnegative(),
      origin: z.enum(["user", "tool", "inference", "manual"]).optional(),
      evidence: z
        .array(
          z.object({
            conversationId: z.number().int(),
            entryId: z.number().int(),
            quote: z.string(),
          }),
        )
        .optional(),
    }),
  ),
  calls: z.array(
    z.looseObject({
      name: z.string(),
      input: z.unknown(),
      output: z.unknown(),
      isError: z.boolean(),
    }),
  ),
  sourceIds: z.array(z.number().int()),
  privateMarker: z.string().min(1),
});
export type MemoryTrial = z.infer<typeof memoryTrial>;

export const memoryReport = z.looseObject({
  subject: z
    .array(
      z
        .looseObject({
          result: memoryTrial.optional(),
          failure: z.record(z.string(), z.unknown()).optional(),
          score: z.object({ passed: z.number(), total: z.number() }).optional(),
        })
        .refine(
          (item) => item.result !== undefined || item.failure !== undefined,
          "Missing execution result or failure",
        ),
    )
    .min(1),
});

export function evaluateMemory(trial: MemoryTrial) {
  const rules: Record<string, boolean> = {};
  const text = trial.memories.map((item) => item.text).join("\n");
  const evidence = trial.memories.flatMap((item) => item.evidence ?? []);
  rules.sourceIdentity = evidence.every((ref) =>
    trial.sourceIds.includes(ref.entryId),
  );
  rules.privateIsolation = !JSON.stringify([
    trial.answer,
    trial.calls,
    trial.memories,
  ]).includes(trial.privateMarker);
  if (trial.id === "city") {
    rules.currentFact = text.includes("上海") && !text.includes("北京");
    rules.inPlaceUpdate =
      trial.memories.length === 1 &&
      trial.memories[0]?.id === "seed" &&
      trial.memories[0].revision > 1;
    rules.userEvidence = trial.memories.some(
      (item) =>
        item.origin === "user" &&
        item.evidence?.some((ref) => ref.quote.includes("上海")),
    );
    rules.historicalRead = trial.calls.some(
      (call) =>
        call.name === "conversation_read" &&
        !call.isError &&
        JSON.stringify(call.output).includes("北京"),
    );
  }
  if (trial.id === "paraphrase")
    rules.retrieval = trial.calls.some(
      (call) =>
        ["memory_search", "conversation_read"].includes(call.name) &&
        !call.isError &&
        JSON.stringify(call.output).includes("先更新界面"),
    );
  if (["manual", "isolation"].includes(trial.id))
    rules.manualProtection = text === "报告必须使用中文。";
  if (trial.id === "deletion") rules.forgotten = trial.memories.length === 0;
  if (trial.id === "restart")
    rules.persisted = text === "报告必须使用公制单位。";
  return {
    rules,
    passed: Object.values(rules).filter(Boolean).length,
    total: Object.keys(rules).length,
    answerReview: "unreviewed" as const,
  };
}
