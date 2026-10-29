import type { Context } from "@earendil-works/chord/context";
import type { Harness } from "@earendil-works/pi-durable";
import { watchCommits } from "../watch.ts";
import { Memory, MemoryDoc, MemoryReviewDoc, memoryUsage } from "./memory.ts";
import { RoutinesDoc } from "./routine-state.ts";
import { Routines } from "./routines.ts";
import { Skills, SkillsDoc } from "./skills.ts";

export function botWork(harness: Harness, now = Date.now) {
  const memory = new Memory(harness);
  const skills = new Skills(harness);
  const routines = new Routines(harness, now);
  const read = async (botId: number, context: Context) => {
    const items = await memory.list(botId, context);
    return {
      memory: items,
      memoryUsage: memoryUsage(items),
      memoryReviewEnabled: await memory.reviewEnabled(botId, context),
      skills: await skills.list(context),
      routines: await routines.list(botId, context),
    };
  };
  return {
    memory,
    setMemoryReviewEnabled: (
      botId: number,
      enabled: boolean,
      context: Context,
    ) => memory.setReviewEnabled(botId, enabled, context),
    skills,
    routines,
    read,
    watch: (botId: number, context: Context) =>
      watchCommits(
        harness,
        (change) =>
          (change.type === "document" || change.type === "document.copy") &&
          [MemoryDoc, MemoryReviewDoc, SkillsDoc, RoutinesDoc].some(
            (doc) => doc.definition.kind === change.record.kind,
          ),
        () => read(botId, context),
        context,
      ),
  };
}

export type BotWork = ReturnType<typeof botWork>;
export { actualPrompt } from "./prompt.ts";
export { WorkError } from "./state.ts";
