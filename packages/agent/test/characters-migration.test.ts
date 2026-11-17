import sharp from "sharp";
import { expect, onTestFinished, test } from "vitest";
import { BotDirectory } from "../src/bots.ts";
import { context, setup } from "./fixtures/work.ts";

test("existing custom characters migrate without changing theme, instructions or equipment", async () => {
  const fixture = await setup();
  let runtime = await fixture.open();
  onTestFinished(() => runtime.harness.close(context));
  const id = runtime.conversation.id;
  const file = await runtime.files.upload(
    id,
    "legacy.png",
    await sharp({
      create: { width: 24, height: 24, channels: 4, background: "#ffe000" },
    })
      .png()
      .toBuffer(),
  );
  const before = await runtime.bots.profile(id, context);
  const media = {
    src: `/files/${id}/${file.id}`,
    cover: `/files/${id}/${file.id}`,
    headset: { x: 42, y: 28, scale: 0.7 },
    computer: { x: 53, y: 57, scale: 0.9 },
  };
  await runtime.harness.commit(async (tx) => {
    const bot = (await tx.doc(BotDirectory)).items.find(
      (item) => item.id === id,
    );
    if (!bot) throw new Error("missing Bot");
    bot.avatarMedia = media;
  }, context);
  await runtime.harness.close(context);
  runtime = await fixture.open();
  const after = await runtime.bots.profile(id, context);
  expect(after.avatarAssetId).toBeTruthy();
  expect(after).toMatchObject({
    name: before.name,
    avatar: before.avatar,
    instructions: before.instructions,
    revision: before.revision,
  });
  expect(after.avatarMedia).toMatchObject({
    headset: media.headset,
    computer: media.computer,
  });
  expect(after.avatarMedia?.src).not.toBe(media.src);
  await runtime.files.discard(id, file.id);
  expect(await runtime.bots.characters.list(id, context)).toHaveLength(1);
  await runtime.harness.close(context);
  runtime = await fixture.open();
  expect(await runtime.bots.characters.list(id, context)).toHaveLength(1);
  expect((await runtime.bots.profile(id, context)).avatarMedia).toEqual(
    after.avatarMedia,
  );
  await runtime.bots.updateIdentity(
    id,
    { resetAvatar: true },
    crypto.randomUUID(),
    context,
  );
  const restored = await runtime.bots.updateIdentity(
    id,
    { avatarAssetId: after.avatarAssetId },
    crypto.randomUUID(),
    context,
  );
  expect(restored.avatarMedia).toMatchObject({
    headset: media.headset,
    computer: media.computer,
  });
  if (!after.avatarMedia) throw new Error("Missing migrated media");
  const legacy = {
    ...after.avatarMedia,
    src: `/files/${id}/${"f".repeat(64)}`,
  };
  await runtime.harness.commit(async (tx) => {
    const bot = (await tx.doc(BotDirectory)).items.find((bot) => bot.id === id);
    if (!bot) throw new Error("Missing Bot");
    bot.avatarMedia = legacy;
    delete bot.avatarAssetId;
  }, context);
  await runtime.bots.migrateCharacters(context, id);
  const failed = await runtime.bots.profile(id, context);
  expect(failed.avatarMedia).toEqual(legacy);
  expect(failed.avatarMigrationError).toContain("角色尚未收录");
  await runtime.harness.commit(async (tx) => {
    const bot = (await tx.doc(BotDirectory)).items.find((bot) => bot.id === id);
    if (!bot) throw new Error("Missing Bot");
    bot.avatarMedia = after.avatarMedia;
  }, context);
  await runtime.bots.migrateCharacters(context, id);
  expect(
    (await runtime.bots.profile(id, context)).avatarMigrationError,
  ).toBeUndefined();
  expect((await runtime.bots.profile(id, context)).avatarAssetId).toBeTruthy();
});
