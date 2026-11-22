import type { MemoryEntry } from "../work/memory.ts";

export type MemoryTrial = {
  id: string;
  answer: string;
  memories: MemoryEntry[];
  calls: { name: string; input: unknown; output: unknown; isError: boolean }[];
  sourceIds: number[];
  privateMarker: string;
};

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
