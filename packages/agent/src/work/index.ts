import type { Context } from "@earendil-works/chord/context";
import type { ConversationId, Harness } from "@earendil-works/pi-durable";
import type { Files } from "../files.ts";
import { EngineDoc } from "../harness/state.ts";
import type { EngineRuntimeState } from "../harness/types.ts";
import { watchCommits } from "../watch.ts";
import { Memory, MemoryDoc, MemoryReviewDoc, memoryUsage } from "./memory.ts";
import { RoutinesDoc } from "./routine-state.ts";
import { Routines } from "./routines.ts";
import { Skills, SkillsDoc } from "./skills.ts";

export function botWork(harness: Harness, now = Date.now, files?: Files) {
  const memory = new Memory(harness);
  const skills = new Skills(harness, files);
  const routines = new Routines(harness, now);
  const read = async (botId: number, context: Context) => {
    const items = await memory.list(botId, context);
    return {
      memory: items,
      memoryUsage: memoryUsage(items),
      memoryReviewEnabled: await memory.reviewEnabled(botId, context),
      skills: await skills.list(context),
      nativeSkills: (
        await harness.snapshot(EngineDoc, botId as ConversationId, context)
      )?.runtime?.nativeSkills,
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
    watch: (botId: number, context: Context) => {
      let catalog: string | undefined;
      return watchCommits(
        harness,
        (change) => {
          if (change.type !== "document" && change.type !== "document.copy")
            return false;
          if (change.record.kind === EngineDoc.definition.kind) {
            if (change.conversationId !== botId || change.type !== "document")
              return false;
            const state = change.value as {
              runtime?: EngineRuntimeState;
            } | null;
            const next = JSON.stringify(state?.runtime?.nativeSkills);
            if (catalog === next) return false;
            catalog = next;
            return true;
          }
          return [MemoryDoc, MemoryReviewDoc, SkillsDoc, RoutinesDoc].some(
            (doc) => doc.definition.kind === change.record.kind,
          );
        },
        () => read(botId, context),
        context,
      );
    },
  };
}

export type BotWork = ReturnType<typeof botWork>;
export { actualPrompt } from "./prompt.ts";
export { WorkError } from "./state.ts";
