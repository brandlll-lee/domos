import { expect, test } from "vitest";
import { botInput, context, setup } from "./fixtures/api.ts";

test("private conversation creation and updates preserve their Bot boundary and history", async () => {
  const { open } = await setup();
  const runtime = await open();
  try {
    const { client, conversation } = runtime;
    const botId = conversation.id;
    const input = { botId, source: botId, requestId: crypto.randomUUID() };
    const second = await client.conversations.create(input);
    expect(await client.conversations.create(input)).toEqual(second);
    expect((await client.get({ botId: second.id })).messages).toEqual([]);
    await client.send({
      botId: second.id,
      text: "\n准备面试\n先核对要求",
      requestId: crypto.randomUUID(),
    });
    await (await runtime.bots.conversation(second.id, context))?.waitForIdle(
      context,
    );
    expect((await client.get({ botId })).messages).toEqual([]);
    expect((await runtime.bots.list(context))[0]?.conversations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: second.id, title: "准备面试" }),
      ]),
    );
    await client.conversations.update({
      botId,
      id: second.id,
      title: "面试",
      archived: true,
    });
    expect((await runtime.bots.list(context))[0]?.conversations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: second.id,
          title: "面试",
          archived: true,
        }),
      ]),
    );
    expect(
      (await client.get({ botId: second.id })).messages.length,
    ).toBeGreaterThan(0);
    const peer = await client.bots.create(botInput("Other"));
    await expect(
      client.conversations.create({
        botId: peer.id,
        source: second.id,
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      client.conversations.update({
        botId: peer.id,
        id: second.id,
        title: "Wrong",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      client.conversations.update({ botId, id: second.id, title: " " }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  } finally {
    await runtime.harness.close(context);
  }
});
