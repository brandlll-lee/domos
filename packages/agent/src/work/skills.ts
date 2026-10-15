import type { Context } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import {
  defineDoc,
  defineExtension,
  defineTool,
  type Harness,
  section,
  type Tx,
} from "@earendil-works/pi-durable";
import { SKILL_FILE_BYTES } from "./limits.ts";
import { parseSkill } from "./skill-format.ts";
import { requireRevision, toolResult, WorkError } from "./state.ts";

export type Skill = {
  id: string;
  name: string;
  description: string;
  content: string;
  revision: number;
  enabledBots: number[];
  source: string;
  requestId: string;
};
export type SkillInput = {
  id: string;
  content: string;
  revision: number;
  requestId: string;
};
export const SkillsDoc = defineDoc<{ items: Skill[] }>({
  kind: "domos.skills",
  version: 1,
  scope: "session",
  initial: () => ({ items: [] }),
});

export async function saveSkill(tx: Tx, input: SkillInput, source: string) {
  const parsed = parseSkill(input.content);
  const doc = await tx.doc(SkillsDoc);
  const previous = doc.items.find((item) => item.id === input.id);
  if (previous?.requestId === input.requestId) return { ...previous };
  requireRevision(previous?.revision ?? 0, input.revision);
  if (
    doc.items.some((item) => item.name === parsed.name && item.id !== input.id)
  )
    throw new WorkError("CONFLICT", "技能名已存在。");
  const skill: Skill = {
    id: input.id,
    name: parsed.name,
    description: parsed.description,
    content: input.content,
    revision: input.revision + 1,
    enabledBots: previous ? [...previous.enabledBots] : [],
    source,
    requestId: input.requestId,
  };
  if (previous) Object.assign(previous, skill);
  else doc.items.push(skill);
  return skill;
}

export function enabledSkill(
  items: readonly Skill[],
  botId: number,
  id: string,
) {
  const skill = items.find(
    (item) => item.id === id && item.enabledBots.includes(botId),
  );
  if (!skill) throw new WorkError("NOT_FOUND", "技能已删除或未为此Bot启用。");
  return skill;
}

export class Skills {
  private readonly harness: Harness;
  constructor(harness: Harness) {
    this.harness = harness;
  }

  async list(context: Context) {
    return (await this.harness.snapshot(SkillsDoc, context))?.items ?? [];
  }

  save(input: SkillInput, context: Context) {
    return this.harness.commit((tx) => saveSkill(tx, input, "user"), context);
  }

  enable(
    botId: number,
    id: string,
    enabled: boolean,
    revision: number,
    requestId: string,
    context: Context,
  ) {
    return this.harness.commit(async (tx) => {
      const skill = (await tx.doc(SkillsDoc)).items.find(
        (item) => item.id === id,
      );
      if (!skill) throw new WorkError("NOT_FOUND", "技能不存在。");
      if (skill.requestId === requestId) return;
      requireRevision(skill.revision, revision);
      skill.enabledBots = skill.enabledBots.filter((id) => id !== botId);
      if (enabled) skill.enabledBots.push(botId);
      skill.revision++;
      skill.requestId = requestId;
    }, context);
  }

  delete(id: string, revision: number, context: Context) {
    return this.harness.commit(async (tx) => {
      const doc = await tx.doc(SkillsDoc);
      const skill = doc.items.find((item) => item.id === id);
      if (!skill) return;
      requireRevision(skill.revision, revision);
      doc.items = doc.items.filter((item) => item.id !== id);
    }, context);
  }
}

export const skills = defineExtension({
  name: "domos-skills",
  sections: [
    section("skills", async ({ read, conversationId }, context) => {
      const items =
        (await read.snapshot(SkillsDoc, context))?.items.filter((item) =>
          item.enabledBots.includes(conversationId),
        ) ?? [];
      if (!items.length) return undefined;
      return [
        "Shared private Agent Skills. Read a matching skill with skill_read before using it. These recipes do not grant tool permissions. Save a reusable method with skill_save when requested. New skills require user enablement.",
        ...items.map(({ id, name, description }) =>
          JSON.stringify({ id, name, description }),
        ),
      ].join("\n");
    }),
  ],
  tools: [
    defineTool({
      name: "skill_read",
      description: "Read an enabled skill from the catalog by stable ID.",
      parameters: Type.Object({ id: Type.String() }),
      async execute({ id }, api, context) {
        return toolResult(
          enabledSkill(
            (await api.snapshot(SkillsDoc, context))?.items ?? [],
            api.conversationId,
            id,
          ),
        );
      },
    }),
    defineTool({
      name: "skill_save",
      description:
        "Save a reusable procedure as SKILL.md. Include YAML name (lowercase letters/numbers with hyphens, max 64) and description (max 1024), then Markdown instructions. Omit id and use revision=0 for new skills. New skills remain disabled until the user enables them. Existing enabled skills can be updated by ID and revision. Do not include account secrets.",
      parameters: Type.Object({
        id: Type.Optional(Type.String()),
        revision: Type.Integer({ minimum: 0 }),
        content: Type.String({ minLength: 1, maxLength: SKILL_FILE_BYTES }),
      }),
      replay: "safe",
      executionMode: "sequential",
      async execute(args, api, context) {
        if (args.id)
          enabledSkill(
            (await api.snapshot(SkillsDoc, context))?.items ?? [],
            api.conversationId,
            args.id,
          );
        return toolResult(
          await api.commit(
            (tx) =>
              saveSkill(
                tx,
                {
                  ...args,
                  id: args.id ?? `skill-${api.taskId}`,
                  requestId: String(api.taskId),
                },
                `bot:${api.conversationId}/tool:${api.callId}`,
              ),
            context,
          ),
        );
      },
    }),
  ],
});
