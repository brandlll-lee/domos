import { characterIdentity, characterSeed } from "@domos/ui/characters";
import sharp from "sharp";
import { expect, onTestFinished, test, vi } from "vitest";
import { Characters } from "../src/characters.ts";
import type { Computers } from "../src/computer/catalog.ts";
import { ComputersDoc } from "../src/computer/state.ts";
import { context, setup } from "./fixtures/work.ts";

test("characters survive source cleanup, reuse across Bots and keep theme changes separate", async () => {
  const fixture = await setup();
  let runtime = await fixture.open();
  onTestFinished(() => runtime.harness.close(context));
  const source = runtime.conversation.id;
  const yellow = await sharp({
    create: { width: 24, height: 24, channels: 4, background: "#ffe000" },
  })
    .png()
    .toBuffer();
  const file = await runtime.files.upload(source, "yellow.png", yellow);
  const applied = await runtime.bots.updateIdentity(
    source,
    { avatarFileId: file.id, coverFileId: file.id },
    "apply-yellow",
    context,
  );
  expect(applied.avatarAssetId).toBeTruthy();
  const assetId = applied.avatarAssetId;
  if (!assetId) throw new Error("asset missing");
  const assets = await runtime.bots.characters.list(source, context);
  expect(assets).toHaveLength(1);
  const pendingInput = {
    name: "Retry creation",
    avatarAssetId: assetId,
    requestId: crypto.randomUUID(),
  };
  const apply = vi
    .spyOn(Characters.prototype, "apply")
    .mockRejectedValueOnce(new Error("transfer interrupted"));
  await expect(runtime.bots.create(pendingInput, context)).rejects.toThrow(
    "transfer interrupted",
  );
  expect(
    (await runtime.bots.list(context)).some(
      (bot) => bot.name === pendingInput.name,
    ),
  ).toBe(false);
  apply.mockRestore();
  await runtime.harness.close(context);
  runtime = await fixture.open();
  expect(
    (await runtime.bots.list(context)).some(
      (bot) => bot.name === pendingInput.name,
    ),
  ).toBe(false);
  const recovered = await runtime.bots.create(pendingInput, context);
  expect(recovered.avatarAssetId).toBe(assetId);
  expect((await runtime.bots.create(pendingInput, context)).id).toBe(
    recovered.id,
  );
  expect(
    (await runtime.bots.list(context)).filter(
      (bot) => bot.name === pendingInput.name,
    ),
  ).toHaveLength(1);
  await expect(
    runtime.bots.create({ ...pendingInput, name: "changed" }, context),
  ).rejects.toThrow("内容已改变");
  const second = await runtime.bots.create(
    {
      name: "Second",
      avatar: characterSeed("round", "#659fff"),
      avatarAssetId: assetId,
      requestId: crypto.randomUUID(),
    },
    context,
  );
  const blue = await runtime.bots.profile(second.id, context);
  expect(blue.avatarAssetId).toBe(assetId);
  expect(characterIdentity(blue.avatar).color).toBe("#659fff");
  expect(blue.avatarMedia?.src).toContain(`/files/${second.id}/`);
  const changed = await runtime.bots.update(
    second.id,
    {
      name: blue.name,
      instructions: blue.instructions,
      avatar: characterSeed("round", "#46d99e"),
      avatarAssetId: assetId,
      revision: blue.revision,
      requestId: crypto.randomUUID(),
    },
    context,
  );
  expect(changed.avatarMedia).toEqual(blue.avatarMedia);
  expect(characterIdentity(changed.avatar).color).toBe("#46d99e");
  await runtime.files.discard(source, file.id);
  const appliedId = applied.avatarMedia?.src.split("/").at(-1);
  if (!appliedId) throw new Error("applied media missing");
  expect(
    Buffer.from(
      await (await runtime.files.download(source, appliedId)).arrayBuffer(),
    ),
  ).toEqual(yellow);
  const third = await runtime.bots.create(
    { name: "Third", avatarAssetId: assetId, requestId: crypto.randomUUID() },
    context,
  );
  expect(third.avatarMedia?.src).toContain(`/files/${third.id}/`);
  const builtin = await runtime.bots.update(
    second.id,
    {
      name: changed.name,
      instructions: changed.instructions,
      avatar: changed.avatar,
      avatarAssetId: null,
      revision: changed.revision,
      requestId: crypto.randomUUID(),
    },
    context,
  );
  expect(builtin.avatarMedia).toBeUndefined();
  expect(characterIdentity(builtin.avatar).color).toBe("#46d99e");
  expect(
    (await runtime.bots.profile(source, context)).avatarMedia,
  ).toBeDefined();
  expect(await runtime.bots.characters.list(source, context)).toHaveLength(1);
  await runtime.harness.commit(async (tx) => {
    const doc = await tx.doc(ComputersDoc);
    doc.items.push(
      {
        id: "local",
        name: "Local",
        authorized: true,
        config: { kind: "process" },
      },
      {
        id: "other",
        name: "Other",
        authorized: true,
        config: { kind: "process" },
      },
    );
  }, context);
  const scoped = new Characters(runtime.harness, runtime.files, {
    binding: async () => ({ computer: { id: "other", authorized: true } }),
  } as unknown as Computers);
  expect(await scoped.list(source, context)).toEqual([]);
  await expect(scoped.apply(second.id, assetId, context)).rejects.toThrow(
    "另一台",
  );
  await expect(scoped.forCreation(assetId, "other", context)).rejects.toThrow(
    "另一台",
  );
  await runtime.harness.commit(async (tx) => {
    const item = (await tx.doc(ComputersDoc)).items.find(
      (item) => item.id === "local",
    );
    if (item) item.authorized = false;
  }, context);
  await expect(scoped.get(assetId, context)).rejects.toThrow("尚未授权");
});
