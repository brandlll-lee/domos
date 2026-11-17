import { createRequire } from "node:module";
import {
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { expect, onTestFinished, test } from "vitest";
import { EngineDoc } from "../../../packages/agent/src/harness/state.ts";
import { botInput, context, setup } from "./fixtures/api.ts";

const sharp = createRequire(
  new URL("../../../packages/agent/package.json", import.meta.url),
)("sharp");

test("character equipment survives role changes and restart within its Bot", async () => {
  const fixture = await setup();
  let runtime = await fixture.open();
  onTestFinished(() => runtime.harness.close(context));
  const botId = runtime.conversation.id;
  const apply = async (color: string) => {
    const bytes = await sharp({
      create: { width: 24, height: 24, channels: 4, background: color },
    })
      .png()
      .toBuffer();
    const file = await runtime.client.files.upload({
      botId,
      file: new File([new Uint8Array(bytes)], "character.png", {
        type: "image/png",
      }),
    });
    return runtime.client.work.identity({
      botId,
      avatarFileId: file.id,
      coverFileId: file.id,
      useOriginal: true,
      revision: (await runtime.client.work.profile({ botId })).revision,
      requestId: crypto.randomUUID(),
    });
  };
  const first = await apply("#ffff00");
  const headset = { x: 23, y: 18, scale: 0.51 };
  const computer = { x: 36, y: 60, scale: 0.72 };
  await runtime.client.work.identity({
    botId,
    headset,
    computer,
    revision: first.revision,
    requestId: crypto.randomUUID(),
  });
  const second = await apply("#0000ff");
  const restored = await runtime.client.work.update({
    botId,
    name: first.name,
    instructions: first.instructions,
    avatar: first.avatar,
    avatarAssetId: first.avatarAssetId,
    revision: second.revision,
    requestId: crypto.randomUUID(),
  });
  expect(restored.avatarMedia).toMatchObject({ headset, computer });
  const themed = await runtime.client.work.update({
    botId,
    name: first.name,
    instructions: first.instructions,
    avatar: crypto.randomUUID(),
    revision: restored.revision,
    requestId: crypto.randomUUID(),
  });
  expect(themed.avatarMedia).toEqual(restored.avatarMedia);
  await runtime.client.work.identity({
    botId,
    resetAvatar: true,
    revision: themed.revision,
    requestId: crypto.randomUUID(),
  });
  await runtime.harness.close(context);
  runtime = await fixture.open();
  const reapplied = await runtime.client.work.identity({
    botId,
    avatarAssetId: first.avatarAssetId,
    revision: (await runtime.client.work.profile({ botId })).revision,
    requestId: crypto.randomUUID(),
  });
  expect(reapplied.avatarMedia).toMatchObject({ headset, computer });
  expect(
    (await runtime.client.bots.list()).find((bot) => bot.id === botId)
      ?.avatarMedia,
  ).toEqual(reapplied.avatarMedia);
  const other = await runtime.client.bots.create({
    ...botInput("Other"),
    avatarAssetId: first.avatarAssetId,
  });
  expect(other.avatarMedia?.headset).toEqual(first.avatarMedia?.headset);
  const changed = await runtime.client.work.update({
    botId,
    name: reapplied.name,
    instructions: reapplied.instructions,
    avatar: reapplied.avatar,
    avatarAssetId: second.avatarAssetId,
    headset,
    revision: reapplied.revision,
    requestId: crypto.randomUUID(),
  });
  expect(changed.avatarMedia?.headset).toEqual(headset);
  expect(
    (await runtime.client.work.profile({ botId: other.id })).avatarMedia
      ?.headset,
  ).toEqual(first.avatarMedia?.headset);
});

test("native skill selections retain their source and follow the active Harness", async () => {
  const { open, faux } = await setup();
  const runtime = await open();
  const botId = runtime.conversation.id;
  onTestFinished(() => runtime.harness.close(context));
  const native = {
    name: "report",
    path: "/skills/report/SKILL.md",
    source: "project",
  };
  await runtime.harness.commit(async (tx) => {
    const doc = await tx.doc(EngineDoc, botId);
    doc.config.provider = "pi";
    doc.runtime = { nativeSkills: [native] };
  }, context);
  expect(await runtime.client.work.get({ botId })).toMatchObject({
    nativeSkills: [native],
    nativeSkillsProvider: "pi",
  });
  faux.setResponses([fauxAssistantMessage("Selected")]);
  const skill = {
    id: native.path,
    native: { ...native, provider: "pi" },
    position: 1,
  };
  await runtime.client.send({
    botId,
    text: "Use this",
    skills: [skill],
    requestId: crypto.randomUUID(),
  });
  await runtime.conversation.waitForIdle(context);
  const sent = (await runtime.client.get({ botId })).messages.find(
    (message) => message.materials?.skills.length,
  );
  expect(sent?.materials?.skills[0]).toMatchObject({
    name: "report",
    native: skill.native,
    position: 1,
  });
  expect(await runtime.work.skills.list(context)).toEqual([]);
  await runtime.harness.commit(async (tx) => {
    const doc = await tx.doc(EngineDoc, botId);
    doc.config.provider = "codex";
    doc.runtime = {};
  }, context);
  await expect(
    runtime.client.send({
      botId,
      text: "Again",
      skills: [skill],
      requestId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("private Bot references reach the current Bot and preserve peer identity", async () => {
  const { open, faux } = await setup();
  const runtime = await open();
  onTestFinished(() => runtime.harness.close(context));
  const botId = runtime.conversation.id;
  const peer = await runtime.client.bots.create(botInput("Reviewer"));
  const reference = { id: crypto.randomUUID(), botId: peer.id, position: 0 };
  faux.setResponses([
    (input) => {
      expect(JSON.stringify(input.messages.at(-1))).toContain(
        `<bot>${JSON.stringify({ botId: peer.id, name: peer.name, avatar: peer.avatar })}</bot>`,
      );
      return fauxAssistantMessage("Reference received");
    },
  ]);
  await runtime.client.send({
    botId,
    text: "",
    bots: [reference],
    requestId: crypto.randomUUID(),
  });
  await runtime.conversation.waitForIdle(context);
  const sent = (await runtime.client.get({ botId })).messages.find(
    (message) => message.role === "user",
  );
  expect(sent?.materials?.bots).toEqual([
    { ...reference, name: peer.name, avatar: peer.avatar },
  ]);
  expect((await runtime.client.get({ botId: peer.id })).messages).toEqual([]);
  await expect(
    runtime.client.send({
      botId,
      text: "请检查",
      bots: [{ ...reference, botId: Number.MAX_SAFE_INTEGER }],
      requestId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

test("Bot work routes enforce ownership, revisions, validation and live updates", async () => {
  const { open } = await setup();
  const runtime = await open();
  let events:
    | AsyncGenerator<Awaited<ReturnType<typeof runtime.client.work.get>>>
    | undefined;
  try {
    const botId = runtime.conversation.id;
    const other = await runtime.client.bots.create(botInput("Second"));
    const profile = await runtime.client.work.profile({ botId });
    const updated = await runtime.client.work.update({
      botId,
      name: "Archivist",
      avatar: profile.avatar,
      instructions: "Organize reports",
      revision: profile.revision,
      requestId: crypto.randomUUID(),
    });
    expect(updated.name).toBe("Archivist");
    expect(
      (await runtime.client.bots.list()).find((bot) => bot.id === botId)
        ?.revision,
    ).toBe(updated.revision);
    await expect(
      runtime.client.work.update({
        botId,
        name: "Stale",
        avatar: profile.avatar,
        instructions: "Stale",
        revision: profile.revision,
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    events = await runtime.client.work.subscribe({ botId });
    expect((await events.next()).value?.memory).toEqual([]);
    const pending = events.next();
    const input = {
      botId,
      id: crypto.randomUUID(),
      text: "Use concise reports",
      shared: false,
      revision: 0,
      requestId: crypto.randomUUID(),
    };
    const memory = await runtime.client.work.memory.save(input);
    expect((await pending).value?.memory[0]?.text).toBe(input.text);
    expect(await runtime.client.work.memory.save(input)).toEqual(memory);
    expect((await runtime.client.work.get({ botId: other.id })).memory).toEqual(
      [],
    );
    await expect(
      runtime.client.work.memory.save({
        ...input,
        botId: other.id,
        revision: memory.revision,
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      runtime.client.work.skills.save({
        botId,
        id: crypto.randomUUID(),
        content: "Invalid SKILL.md",
        revision: 0,
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const routine = await runtime.client.work.routines.save({
      botId,
      id: crypto.randomUUID(),
      title: "Report",
      instructions: "Prepare a report",
      schedule: {
        type: "cron",
        expression: "0 9 * * *",
        timeZone: "Asia/Shanghai",
      },
      skillIds: [],
      revision: 0,
      requestId: crypto.randomUUID(),
    });
    expect(routine.enabled).toBe(false);
    await expect(
      runtime.client.work.routines.enable({
        botId: other.id,
        id: routine.id,
        enabled: true,
        revision: routine.revision,
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      runtime.client.work.get({ botId: Number.MAX_SAFE_INTEGER }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      runtime.client.work.routines.save({
        ...routine,
        schedule: { type: "cron", expression: "invalid", timeZone: "UTC" },
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await runtime.client.work.memory.delete({
      botId,
      id: memory.id,
      revision: memory.revision,
    });
    await runtime.client.work.routines.delete({
      botId,
      id: routine.id,
      revision: routine.revision,
    });
    expect((await runtime.client.work.get({ botId })).routines.items).toEqual(
      [],
    );
    expect((await runtime.client.work.get({ botId })).memory).toEqual([]);
  } finally {
    await events?.return(undefined as never);
    await runtime.harness.close(context);
  }
});

test("computer routes expose actual execution boundaries and validate Bot ownership", async () => {
  const { open } = await setup();
  const runtime = await open();
  const controller = new AbortController();
  try {
    const botId = runtime.conversation.id;
    expect(
      (await runtime.client.computer.get({ botId })).computer,
    ).toMatchObject({
      kind: "process",
      state: "running",
      boundary: "host",
    });
    const events = await runtime.client.bots.subscribe(undefined, {
      signal: controller.signal,
    });
    let update = await events.next();
    while (!update.done && !update.value.computers.length)
      update = await events.next();
    expect(update.value?.computers[0]).toMatchObject({ boundary: "host" });
    expect(update.value?.items).toHaveLength(1);
    controller.abort();
    await expect(
      runtime.client.computer.get({ botId: Number.MAX_SAFE_INTEGER }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      runtime.client.computer.manage({ id: "process", action: "stop" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  } finally {
    controller.abort();
    await runtime.harness.close(context);
  }
});

test("request skills and message references store authoritative snapshots across restart", async () => {
  const { open, faux } = await setup();
  const runtime = await open();
  const botId = runtime.conversation.id;
  let requestId = "";
  try {
    faux.setResponses([
      fauxAssistantMessage("Original source"),
      fauxAssistantMessage("Used references"),
    ]);
    await runtime.client.send({
      botId,
      text: "Source request",
      requestId: crypto.randomUUID(),
    });
    await runtime.conversation.waitForIdle(context);
    const source = (await runtime.client.get({ botId })).messages.find(
      (message) => message.role === "assistant",
    );
    const skill = await runtime.work.skills.save(
      {
        id: crypto.randomUUID(),
        content:
          "---\nname: report\ndescription: Write a report\n---\nUse the saved method.",
        revision: 0,
        requestId: crypto.randomUUID(),
      },
      context,
    );
    await runtime.work.skills.enable(
      botId,
      skill.id,
      true,
      skill.revision,
      crypto.randomUUID(),
      context,
    );
    const enabled = (await runtime.work.skills.list(context))[0];
    if (!enabled) throw new Error("Missing skill");
    const selection = { id: skill.id, revision: enabled.revision };
    await expect(
      runtime.client.send({
        botId,
        text: "Use this",
        skills: [{ ...selection, revision: 0 }],
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      runtime.client.send({
        botId,
        text: "Quote",
        context: [
          {
            id: crypto.randomUUID(),
            type: "message",
            messageId: "other-bot-message",
          },
        ],
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    faux.setResponses([
      (input) => {
        const received = JSON.stringify(input.messages.at(-1));
        expect(received).toContain("skill_read");
        expect(received).not.toContain("Use the saved method.");
        return fauxAssistantMessage(
          fauxToolCall("skill_read", { id: skill.id }),
          { stopReason: "toolUse" },
        );
      },
      (input) => {
        expect(JSON.stringify(input.messages.at(-1))).toContain(
          "Use the saved method.",
        );
        return fauxAssistantMessage("Used references");
      },
    ]);
    requestId = crypto.randomUUID();
    const input = {
      botId,
      text: "Use these",
      skills: [{ ...selection, position: 1 }],
      context: [
        {
          id: crypto.randomUUID(),
          type: "message" as const,
          messageId: source?.id ?? "",
          position: 2,
        },
        { id: crypto.randomUUID(), type: "text" as const, text: "Quoted text" },
      ],
      requestId,
    };
    const receipt = await runtime.client.send(input);
    await runtime.conversation.waitForIdle(context);
    await runtime.work.skills.enable(
      botId,
      skill.id,
      false,
      enabled.revision,
      crypto.randomUUID(),
      context,
    );
    expect(await runtime.client.send(input)).toEqual(receipt);
    const sent = (await runtime.client.get({ botId })).messages.find(
      (message) => message.requestId === requestId,
    );
    expect(sent?.materials?.context[0]).toMatchObject({
      messageId: source?.id,
      text: "Original source",
      botId,
      position: 2,
    });
    expect(sent?.materials?.skills[0]).toMatchObject({
      name: "report",
      revision: enabled.revision,
      content: skill.content,
      position: 1,
    });
    expect((await runtime.work.skills.list(context))[0]?.enabledBots).toEqual(
      [],
    );
  } finally {
    await runtime.harness.close(context);
  }
  const reopened = await open();
  try {
    const sent = (await reopened.client.get({ botId })).messages.find(
      (message) => message.requestId === requestId,
    );
    expect(sent?.materials?.context).toHaveLength(2);
    expect(sent?.materials?.skills[0]?.name).toBe("report");
    expect(sent?.materials?.skills[0]?.position).toBe(1);
    expect(sent?.materials?.context[0]?.position).toBe(2);
  } finally {
    await reopened.harness.close(context);
  }
});
