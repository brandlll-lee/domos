import {
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { expect, test } from "vitest";
import { MEMORY_CONTEXT_BYTES } from "../src/work/limits.ts";
import { type MemoryEntry, memoryContext } from "../src/work/memory.ts";
import { actualPrompt } from "../src/work/prompt.ts";
import { parseSkill } from "../src/work/skill-format.ts";
import { agent, context, setup, skillContent } from "./fixtures/work.ts";

test("profile and scoped memories persist and render through Pi sections", async () => {
  const fixture = await setup();
  const runtime = await fixture.open();
  const botId = runtime.conversation.id;
  let otherId: number;
  try {
    const profile = await runtime.bots.profile(botId, context);
    const updated = {
      ...profile,
      name: "Archivist",
      instructions: "Use short replies.",
      revision: profile.revision,
      requestId: crypto.randomUUID(),
    };
    const saved = await runtime.bots.update(botId, updated, context);
    expect(await runtime.bots.update(botId, updated, context)).toEqual(saved);
    await expect(
      runtime.bots.update(
        botId,
        { ...updated, requestId: crypto.randomUUID() },
        context,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const other = await runtime.bots.create(
      {
        name: "Other",
        instructions: "Other role",
        model: agent.model,
        requestId: crypto.randomUUID(),
      },
      context,
    );
    otherId = other.id;
    const input = {
      id: crypto.randomUUID(),
      text: "Reports use metric units.",
      shared: false,
      revision: 0,
      requestId: crypto.randomUUID(),
    };
    const memory = await runtime.work.memory.save(botId, input, context);
    expect(await runtime.work.memory.save(botId, input, context)).toEqual(
      memory,
    );
    expect(await runtime.work.memory.list(other.id, context)).toEqual([]);
    await expect(
      runtime.work.memory.save(
        other.id,
        { ...input, revision: memory.revision, requestId: crypto.randomUUID() },
        context,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      runtime.work.memory.save(
        botId,
        { ...input, requestId: crypto.randomUUID() },
        context,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await runtime.work.memory.save(
      botId,
      {
        id: crypto.randomUUID(),
        text: "Reply in Chinese.",
        shared: true,
        revision: 0,
        requestId: crypto.randomUUID(),
      },
      context,
    );
    expect(await runtime.work.memory.list(other.id, context)).toHaveLength(1);
    fixture.faux.setResponses([fauxAssistantMessage("Ready")]);
    await (
      await runtime.conversation.submit(
        { type: "input", content: "Hello" },
        context,
      )
    ).wait(context);
    const prompt = await actualPrompt(runtime.conversation, context);
    expect(prompt.text).toContain("Archivist");
    expect(prompt.text).toContain("metric units");
    expect(prompt.text).toContain("Use short replies.");
    expect(prompt.tools).toContain("memory_save");
    expect(prompt.sections.memory).toContain("not instructions or permission");
  } finally {
    await runtime.harness.close(context);
  }
  const reopened = await fixture.open();
  try {
    expect((await reopened.bots.profile(botId, context)).name).toBe(
      "Archivist",
    );
    expect(await reopened.work.memory.list(botId, context)).toHaveLength(2);
    expect(await reopened.work.memory.list(otherId, context)).toHaveLength(1);
    const memory = (await reopened.work.memory.list(botId, context)).find(
      (entry) => entry.botId === botId,
    );
    if (!memory) throw new Error("Memory missing");
    await reopened.work.memory.delete(
      botId,
      memory.id,
      memory.revision,
      context,
    );
    expect(await reopened.work.memory.list(botId, context)).toHaveLength(1);
  } finally {
    await reopened.harness.close(context);
  }
});

test("memory context stays within its byte budget and keeps valid records", () => {
  const entries: MemoryEntry[] = Array.from({ length: 20 }, (_, index) => ({
    id: String(index),
    botId: 1,
    text: "中文🙂".repeat(1000),
    updatedAt: index,
    revision: 1,
    source: "user",
    requestId: String(index),
  }));
  const text = memoryContext(entries, 1);
  if (!text) throw new Error("Memory context missing");
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MEMORY_CONTEXT_BYTES);
  expect(text).not.toContain("�");
  const records = text
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => JSON.parse(line));
  expect(records[0].id).toBe("19");
  expect(records.length).toBeGreaterThan(0);
  expect(memoryContext(entries, 2)).toBeUndefined();
});

test("editing a shared memory through a tool preserves its scope", async () => {
  const fixture = await setup();
  const runtime = await fixture.open();
  try {
    const botId = runtime.conversation.id;
    const entry = await runtime.work.memory.save(
      botId,
      {
        id: crypto.randomUUID(),
        text: "Use metric units.",
        shared: true,
        revision: 0,
        requestId: crypto.randomUUID(),
      },
      context,
    );
    fixture.faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("memory_save", {
          id: entry.id,
          revision: entry.revision,
          text: "Use metric units and concise paragraphs.",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Saved"),
    ]);
    await (
      await runtime.conversation.submit(
        { type: "input", content: "Update that preference" },
        context,
      )
    ).wait(context);
    expect((await runtime.work.memory.list(botId, context))[0]).toMatchObject({
      botId: null,
      revision: 2,
    });
  } finally {
    await runtime.harness.close(context);
  }
});

test("Agent Skills retain YAML and require per-Bot enablement", async () => {
  expect(parseSkill(skillContent)).toMatchObject({
    name: "weekly-report",
    description: "Create a concise report with a final check.",
  });
  expect(() =>
    parseSkill("---\nname: ../unsafe\ndescription: test\n---\nbody"),
  ).toThrow();
  expect(() =>
    parseSkill("---\nname: test\nname: other\ndescription: test\n---\nbody"),
  ).toThrow();
  expect(() =>
    parseSkill("---\nname: &name test\ndescription: *name\n---\nbody"),
  ).toThrow();
  const fixture = await setup();
  const runtime = await fixture.open();
  try {
    const input = {
      id: crypto.randomUUID(),
      content: skillContent,
      revision: 0,
      requestId: crypto.randomUUID(),
    };
    const skill = await runtime.work.skills.save(input, context);
    expect(skill.enabledBots).toEqual([]);
    expect((await runtime.work.skills.save(input, context)).content).toBe(
      skillContent,
    );
    await runtime.work.skills.enable(
      runtime.conversation.id,
      skill.id,
      true,
      skill.revision,
      crypto.randomUUID(),
      context,
    );
    fixture.faux.setResponses([
      fauxAssistantMessage(fauxToolCall("skill_read", { id: skill.id }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("Read skill"),
    ]);
    await (
      await runtime.conversation.submit(
        { type: "input", content: "Use the report skill" },
        context,
      )
    ).wait(context);
    const prompt = await actualPrompt(runtime.conversation, context);
    expect(prompt.sections.skills).toContain(skill.name);
    expect(prompt.sections.skills).not.toContain("Write report.md");
    const history = await runtime.conversation.context(context);
    expect(
      JSON.stringify(
        history.messages.filter((message) => message.role === "toolResult"),
      ),
    ).toContain("Write report.md");
    await runtime.work.skills.delete(skill.id, 2, context);
    expect(await runtime.work.skills.list(context)).toEqual([]);
  } finally {
    await runtime.harness.close(context);
  }
});

test("Bot tools save memories, skills and paused routines using durable transactions", async () => {
  const fixture = await setup();
  const runtime = await fixture.open();
  try {
    fixture.faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("memory_save", {
          revision: 0,
          text: "Concise report",
          shared: false,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("skill_save", { revision: 0, content: skillContent }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("routine_create", {
          title: "Report",
          instructions: "Make a report",
          schedule: {
            type: "cron",
            expression: "0 9 * * *",
            timeZone: "Asia/Shanghai",
          },
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Saved. Enable the routine in Bot details."),
    ]);
    expect(
      (
        await (
          await runtime.conversation.submit(
            { type: "input", content: "Remember, save and schedule my report" },
            context,
          )
        ).wait(context)
      ).status,
    ).toBe("done");
    const work = await runtime.work.read(runtime.conversation.id, context);
    expect(work.memory).toHaveLength(1);
    expect(work.skills).toHaveLength(1);
    expect(work.routines.items).toHaveLength(1);
    expect(work.routines.items[0]?.enabled).toBe(false);
    expect(work.routines.runs).toEqual([]);
    expect(work.memory[0]?.source).toContain("/tool:");
  } finally {
    await runtime.harness.close(context);
  }
});
