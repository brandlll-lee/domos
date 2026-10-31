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
import type { Files } from "../files.ts";
import { EngineDoc } from "../harness/state.ts";
import { SKILL_FILE_BYTES } from "./limits.ts";
import { SkillPackages, skillPackage } from "./skill-package.ts";
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
  hash?: string;
  versions?: { hash: string; version: number }[];
};
export type SkillInput = {
  id: string;
  content: string;
  revision: number;
  requestId: string;
  archive?: string;
};
export const SkillsDoc = defineDoc<{ items: Skill[] }>({
  kind: "domos.skills",
  version: 1,
  checkpointWhen: () => false,
  scope: "session",
  initial: () => ({ items: [] }),
});

export async function saveSkill(
  tx: Tx,
  input: SkillInput,
  source: string,
  packages?: SkillPackages,
) {
  const doc = await tx.doc(SkillsDoc);
  const previous = doc.items.find((item) => item.id === input.id);
  if (previous?.requestId === input.requestId)
    return {
      ...previous,
      enabledBots: [...previous.enabledBots],
      versions: previous.versions?.map((version) => ({ ...version })),
    };
  requireRevision(previous?.revision ?? 0, input.revision);
  const archive =
    input.archive ??
    (previous?.hash && packages
      ? await packages.read(previous.hash)
      : undefined);
  const parsed = skillPackage(input.content, archive);
  if (
    doc.items.some((item) => item.name === parsed.name && item.id !== input.id)
  )
    throw new WorkError("CONFLICT", "技能名已存在。");

  await packages?.store(parsed);
  const versions = [
    ...(previous?.versions?.map((version) => ({ ...version })) ??
      (previous
        ? [{ hash: skillPackage(previous.content).hash, version: 1 }]
        : [])),
  ];
  if (previous && !previous.hash)
    await packages?.store(skillPackage(previous.content));
  if (versions.at(-1)?.hash !== parsed.hash)
    versions.push({
      hash: parsed.hash,
      version: (versions.at(-1)?.version ?? 0) + 1,
    });
  const skill: Skill = {
    id: input.id,
    name: parsed.name,
    description: parsed.description,
    content: parsed.content,
    hash: parsed.hash,
    versions,
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
  readonly packages?: SkillPackages;
  constructor(harness: Harness, files?: Files) {
    this.harness = harness;
    if (files) this.packages = new SkillPackages(files);
  }

  async list(context: Context) {
    return (await this.harness.snapshot(SkillsDoc, context))?.items ?? [];
  }

  save(input: SkillInput, context: Context) {
    return this.harness.commit(
      (tx) => saveSkill(tx, input, "user", this.packages),
      context,
    );
  }

  async preview(
    content: string,
    archive: string | undefined,
    id: string | undefined,
    context: Context,
  ) {
    const previous = (await this.list(context)).find((item) => item.id === id);
    const bundle = skillPackage(
      content,
      archive ??
        (previous?.hash && this.packages
          ? await this.packages.read(previous.hash)
          : undefined),
    );
    const before = previous
      ? skillPackage(
          previous.content,
          previous.hash && this.packages
            ? await this.packages.read(previous.hash)
            : undefined,
        )
      : null;
    return {
      content: bundle.content,
      hash: bundle.hash,
      name: bundle.name,
      description: bundle.description,
      changes: [
        ...new Set([...Object.keys(before?.files ?? {}), ...bundle.paths]),
      ]
        .sort()
        .flatMap((path) => {
          const old = before?.files[path];
          const next = bundle.files[path];
          if (old && next && Buffer.from(old).equals(Buffer.from(next)))
            return [];
          const text = (bytes: Uint8Array | undefined) =>
            bytes && !bytes.includes(0) && bytes.length <= 64 * 1024
              ? new TextDecoder().decode(bytes)
              : null;
          return [
            {
              path,
              status: !old ? "added" : !next ? "deleted" : "changed",
              before: text(old),
              after: text(next),
            },
          ];
        }),
    };
  }

  async export(id: string, hash: string | undefined, context: Context) {
    const skill = (await this.list(context)).find((item) => item.id === id);
    if (
      !skill ||
      (hash && !skill.versions?.some((version) => version.hash === hash))
    )
      throw new WorkError("NOT_FOUND", "技能版本不存在。");
    if (!this.packages)
      throw new WorkError("BAD_REQUEST", "技能包存储不可用。");
    const bundle = skillPackage(skill.content);
    if (!skill.hash) await this.packages.store(bundle);
    return {
      name: skill.name,
      archive: await this.packages.read(hash ?? skill.hash ?? bundle.hash),
    };
  }

  async restore(
    id: string,
    hash: string,
    revision: number,
    requestId: string,
    context: Context,
  ) {
    const archive = await this.export(id, hash, context);
    return this.save(
      { id, content: "", archive: archive.archive, revision, requestId },
      context,
    );
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

export function skillExtension(files?: Files) {
  const packages = files ? new SkillPackages(files) : undefined;
  return defineExtension({
    name: "domos-skills",
    sections: [
      section("skills", async ({ read, conversationId }, context) => {
        const native =
          (await read.snapshot(EngineDoc, conversationId, context))?.runtime
            ?.nativeSkills ?? [];
        const items =
          (await read.snapshot(SkillsDoc, context))?.items.filter(
            (item) =>
              item.enabledBots.includes(conversationId) &&
              !native.some((loaded) => loaded.name === item.name),
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
          const skill = enabledSkill(
            (await api.snapshot(SkillsDoc, context))?.items ?? [],
            api.conversationId,
            id,
          );
          const path =
            skill.hash && packages
              ? await packages.materialize(
                  api.conversationId,
                  skill.hash,
                  context,
                )
              : undefined;
          return toolResult({ ...skill, ...(path ? { path } : {}) });
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
                  packages,
                ),
              context,
            ),
          );
        },
      }),
    ],
  });
}
