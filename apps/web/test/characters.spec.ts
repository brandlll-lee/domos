import { createRequire } from "node:module";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { expect } from "@playwright/test";
import type { client as appClient } from "../src/client.ts";
import { test } from "./fixtures/service.ts";

const sharp = createRequire(
  new URL("../../../packages/agent/package.json", import.meta.url),
)("sharp");

test("character retention failure stays visible and explicit retry clears it", async ({
  page,
  service,
}) => {
  let inject = true;
  await page.route("**/rpc/work/profile", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (inject)
      body.json.avatarMigrationError =
        "角色尚未收录，现有头像已保留。文件引用无效。";
    await route.fulfill({ response, json: body });
  });
  await page.goto(service.url);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const details = page.locator("#bot-details");
  await details.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(
    details.getByText("角色尚未收录，现有头像已保留。文件引用无效。", {
      exact: true,
    }),
  ).toBeVisible();
  inject = false;
  await details
    .getByRole("button", { name: "重试收录角色", exact: true })
    .click();
  await expect(
    details.getByRole("button", { name: "重试收录角色", exact: true }),
  ).toHaveCount(0);
  await expect(
    details.getByRole("textbox", { name: "名字", exact: true }),
  ).toHaveValue("Domos");
});

test("saved characters keep their pixels, share across Bots and transform only on identity changes", async ({
  page,
  service,
}) => {
  test.setTimeout(120000);
  const api = createORPCClient<typeof appClient>(
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  const source = (await api.bots.list())[0];
  if (!source) throw new Error("Bot missing");
  const bytes = await sharp({
    create: { width: 64, height: 64, channels: 4, background: "#ffe000" },
  })
    .png()
    .toBuffer();
  const file = await api.files.upload({
    botId: source.id,
    file: new File([bytes], "yellow.png", { type: "image/png" }),
  });
  await page.goto(service.url);
  await expect(page.locator(".chat-header .character-body")).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { bursts: unknown[] }).bursts = [];
    document.addEventListener("animationstart", (event) => {
      const animation = event as AnimationEvent;
      if (
        animation.animationName === "character-work-poof" &&
        (event.target as Element).closest(".identity-burst")
      )
        (window as unknown as { bursts: unknown[] }).bursts.push({
          old: (
            document.querySelector(
              ".chat-header .character-body > image",
            ) as SVGImageElement
          )?.getAttribute("href"),
        });
    });
  });
  const profile = await api.work.profile({ botId: source.id });
  const applied = await api.work.identity({
    botId: source.id,
    name: "黄色角色",
    avatarFileId: file.id,
    coverFileId: file.id,
    revision: profile.revision,
    requestId: crypto.randomUUID(),
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { bursts: unknown[] }).bursts.length,
      ),
    )
    .toBe(1);
  await expect(page.locator(".identity-avatar")).not.toHaveAttribute(
    "data-changing",
    "true",
  );
  await expect(
    page.locator(".chat-header .character-body > image"),
  ).toHaveAttribute("href", applied.avatarMedia?.src ?? "");
  const assets = await api.bots.characters({ botId: source.id });
  expect(assets).toHaveLength(1);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const details = page.locator("#bot-details");
  await details.getByRole("button", { name: "编辑", exact: true }).click();
  await details.getByRole("button", { name: "选择头像", exact: true }).click();
  await page.getByRole("button", { name: "颜色：晴蓝", exact: true }).click();
  await page.keyboard.press("Escape");
  await details.getByRole("button", { name: "保存身份", exact: true }).click();
  await expect
    .poll(async () => (await api.work.profile({ botId: source.id })).avatar)
    .not.toBe(applied.avatar);
  const blue = await api.work.profile({ botId: source.id });
  expect(blue.avatarMedia).toEqual(applied.avatarMedia);
  expect(
    await page.evaluate(
      () => (window as unknown as { bursts: unknown[] }).bursts.length,
    ),
  ).toBe(1);
  await expect(
    page.locator(".chat-header .character-body > image"),
  ).toHaveAttribute("href", applied.avatarMedia?.src ?? "");
  await details.getByLabel("名字", { exact: true }).fill("蓝色主题的奶龙");
  await details.getByRole("button", { name: "保存身份", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { bursts: unknown[] }).bursts.length,
      ),
    )
    .toBe(2);
  await expect(page.locator(".identity-avatar")).not.toHaveAttribute(
    "data-changing",
    "true",
  );
  await page.screenshot({
    path: "test-results/character-theme-separation.png",
  });
  await details.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page.getByRole("menuitem", { name: "新建 Bot", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建 Bot", exact: true });
  await dialog.getByRole("button", { name: "选择头像", exact: true }).click();
  await page.getByRole("button", { name: "我的角色", exact: true }).click();
  await page
    .getByRole("button", { name: "角色：黄色角色", exact: true })
    .click();
  await page.getByRole("button", { name: "颜色：翡翠绿", exact: true }).click();
  await page.keyboard.press("Escape");
  await dialog.getByLabel("名字", { exact: true }).fill("复用角色");
  await page.screenshot({ path: "test-results/character-create-picker.png" });
  await dialog.getByRole("button", { name: "创建", exact: true }).click();
  await dialog.getByRole("button", { name: "Pi", exact: true }).click();
  await dialog.getByRole("combobox", { name: "模型", exact: true }).click();
  await page
    .getByRole("option", { name: "Pi · 测试模型一", exact: true })
    .click();
  await dialog.getByRole("button", { name: "开始聊天", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const second = (await api.bots.list()).find((bot) => bot.name === "复用角色");
  if (!second) throw new Error("Second Bot missing");
  expect(second.avatarAssetId).toBe(applied.avatarAssetId);
  expect(second.avatar).not.toBe(blue.avatar);
  await expect(
    page.locator(".chat-header .character-body > image"),
  ).toHaveAttribute("href", second.avatarMedia?.src ?? "");
  expect(
    await page.evaluate(
      () => (window as unknown as { bursts: unknown[] }).bursts.length,
    ),
  ).toBe(2);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await details.getByRole("button", { name: "编辑", exact: true }).click();
  await details.getByRole("button", { name: "选择头像", exact: true }).click();
  await page.getByRole("button", { name: "内置角色", exact: true }).click();
  await page.getByRole("button", { name: "外形：圆球", exact: true }).click();
  await page.keyboard.press("Escape");
  await details.getByRole("button", { name: "保存身份", exact: true }).click();
  await expect
    .poll(
      async () => (await api.work.profile({ botId: second.id })).avatarMedia,
    )
    .toBeUndefined();
  await expect(
    page.locator(".chat-header .character-body > image"),
  ).toHaveAttribute("filter", /tint/);
  expect((await api.work.profile({ botId: second.id })).avatar).toContain(
    "46d99e",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  const latest = await api.work.profile({ botId: second.id });
  await api.work.identity({
    botId: second.id,
    name: "减少动态效果",
    revision: latest.revision,
    requestId: crypto.randomUUID(),
  });
  await expect(page.locator(".chat-identity-name")).toHaveText("减少动态效果");
  await expect(page.locator(".identity-burst")).toHaveCount(0);
});
