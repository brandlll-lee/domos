import { createRequire } from "node:module";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { expect } from "@playwright/test";
import type { client as appClient } from "../src/client.ts";
import { test } from "./fixtures/service.ts";

const sharp = createRequire(
  new URL("../../../packages/agent/package.json", import.meta.url),
)("sharp");

test("avatar editors open with complete built-in and saved characters while full images prepare", async ({
  page,
  service,
}, info) => {
  const api = createORPCClient<typeof appClient>(
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  const bot = (await api.bots.list())[0];
  if (!bot) throw new Error("Bot missing");
  const bytes = await sharp({
    create: { width: 1024, height: 640, channels: 4, background: "#ffe000" },
  })
    .png()
    .toBuffer();
  const file = await api.files.upload({
    botId: bot.id,
    file: new File([bytes], "saved.png", { type: "image/png" }),
  });
  const applied = await api.work.identity({
    botId: bot.id,
    avatarFileId: file.id,
    coverFileId: file.id,
    useOriginal: true,
    revision: (await api.work.profile({ botId: bot.id })).revision,
    requestId: crypto.randomUUID(),
  });
  await api.work.update({
    botId: bot.id,
    name: applied.name,
    instructions: applied.instructions,
    avatar: applied.avatar,
    avatarAssetId: null,
    revision: applied.revision,
    requestId: crypto.randomUUID(),
  });
  const asset = (await api.bots.characters({ botId: bot.id }))[0];
  if (!asset?.media.thumbnail) throw new Error("Thumbnail missing");
  const release = Promise.withResolvers<void>();
  const requested = Promise.withResolvers<void>();
  await page.route("**/rpc/bots/characters", async (route) => {
    requested.resolve();
    await release.promise;
    await route.continue();
  });
  const original = Promise.withResolvers<void>();
  await page.route(
    `**/files/characters/${asset.id}/{cover,image}`,
    async (route) => {
      await original.promise;
      await route.continue();
    },
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(service.url);
    await expect(
      page.getByRole("button", { name: "Bot详情", exact: true }),
    ).toBeVisible();
    await requested.promise;
    await page.getByRole("button", { name: "Bot详情", exact: true }).click();
    const details = page.locator("#bot-details");
    await details.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(
      details.getByRole("button", { name: "编辑", exact: true }),
    ).toHaveAttribute("aria-busy", "true");
    await expect(details.locator(".avatar-editor")).toHaveCount(0);
    release.resolve();
    const picker = details.locator(".avatar-editor");
    await expect(picker.getByRole("button", { name: /^外形：/ })).toHaveCount(
      15,
    );
    expect(
      await picker.locator('[aria-label="外形"] .character-face').count(),
    ).toBe(15);
    await expect(picker.getByRole("status")).toHaveCount(0);
    expect(
      await sharp(
        Buffer.from(asset.media.thumbnail.split(",")[1] ?? "", "base64"),
      ).metadata(),
    ).toMatchObject({ width: 160, height: 100 });
    const reads: string[] = [];
    page.on("request", (request) => reads.push(request.url()));
    await picker.getByRole("tab", { name: "我的角色", exact: true }).click();
    const choice = picker.getByRole("button", { name: /^角色：/ });
    await expect(choice.locator(".character-body > image")).toHaveAttribute(
      "href",
      asset.media.thumbnail,
    );
    await choice.click();
    await expect(
      picker.locator(".avatar-preview .character-body > image"),
    ).toHaveAttribute("href", asset.media.thumbnail);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await picker.screenshot({
        path: info.outputPath(`characters-${colorScheme}.png`),
      });
    }
    await details.getByRole("button", { name: "返回", exact: true }).click();
    const before = reads.length;
    await details.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(choice.locator(".character-body > image")).toBeVisible();
    expect(reads.slice(before)).toEqual([]);
    await details.getByRole("button", { name: "返回", exact: true }).click();
    await details.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "新建", exact: true }).click();
    await page.getByRole("menuitem", { name: "新建 Bot", exact: true }).click();
    const creation = page.getByRole("dialog", {
      name: "新建 Bot",
      exact: true,
    });
    await expect(
      creation.locator('[aria-label="外形"] .character-face'),
    ).toHaveCount(15);
    await expect(creation.getByRole("status")).toHaveCount(0);
    await creation.getByRole("button", { name: "取消", exact: true }).click();
    expect(errors).toEqual([]);
  } finally {
    release.resolve();
    original.resolve();
    await page.unrouteAll({ behavior: "wait" });
  }
});
