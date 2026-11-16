import { createRequire } from "node:module";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { expect } from "@playwright/test";
import type { client as appClient } from "../src/client.ts";
import { test } from "./fixtures/service.ts";

const sharp = createRequire(
  new URL("../../../packages/agent/package.json", import.meta.url),
)("sharp");

test("profile updates merge with drafts and keep character equipment scoped", async ({
  page,
  service,
}, info) => {
  test.setTimeout(60000);
  const api = createORPCClient<typeof appClient>(
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  const bot = (await api.bots.list())[0];
  if (!bot) throw new Error("Bot missing");
  const apply = async (color: string) => {
    const bytes = await sharp({
      create: { width: 32, height: 32, channels: 4, background: color },
    })
      .png()
      .toBuffer();
    const file = await api.files.upload({
      botId: bot.id,
      file: new File([bytes], `${color.slice(1)}.png`, { type: "image/png" }),
    });
    const profile = await api.work.profile({ botId: bot.id });
    return api.work.identity({
      botId: bot.id,
      avatarFileId: file.id,
      coverFileId: file.id,
      useOriginal: true,
      revision: profile.revision,
      requestId: crypto.randomUUID(),
    });
  };
  await apply("#ff0000");
  await page.goto(service.url);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const details = page.locator("#bot-details");
  await details.getByRole("button", { name: "编辑", exact: true }).click();
  const name = details.getByRole("textbox", { name: "名字", exact: true });
  const save = details.getByRole("button", { name: "保存身份", exact: true });
  await name.fill("My name");
  const yellow = await apply("#ffff00");
  await expect(
    details.locator(".avatar-editor .character-body > image"),
  ).toHaveAttribute("href", yellow.avatarMedia?.src ?? "");
  await expect(
    details.locator(".setting-row .character-body > image"),
  ).toHaveAttribute("href", yellow.avatarMedia?.cover ?? "");
  await expect(name).toHaveValue("My name");
  await expect(name).toBeFocused();
  await api.work.update({
    botId: bot.id,
    name: yellow.name,
    instructions: "Remote instructions",
    avatar: yellow.avatar,
    revision: yellow.revision,
    requestId: crypto.randomUUID(),
  });
  await expect(
    details.getByRole("textbox", { name: "职责与长期指令", exact: true }),
  ).toHaveValue("Remote instructions");
  await save.click();
  await expect(save).toHaveCount(0);
  expect(await api.work.profile({ botId: bot.id })).toMatchObject({
    name: "My name",
    instructions: "Remote instructions",
    avatarAssetId: yellow.avatarAssetId,
  });

  await name.fill("Retained name");
  await details
    .getByRole("spinbutton", { name: "耳机水平", exact: true })
    .fill("23");
  await details
    .getByRole("button", { name: "保存装备位置", exact: true })
    .click();
  await expect(
    details.getByRole("button", { name: "保存装备位置", exact: true }),
  ).toBeDisabled();
  await expect(name).toHaveValue("Retained name");
  await save.click();
  await expect(save).toHaveCount(0);
  await details
    .getByRole("spinbutton", { name: "耳机水平", exact: true })
    .fill("31");
  const blue = await apply("#0000ff");
  await expect(
    details.getByText("耳机位置已在别处更新。请选择要保留的内容。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    details.getByRole("button", { name: "保存装备位置", exact: true }),
  ).toBeDisabled();
  await page.screenshot({ path: info.outputPath("equipment-conflict.png") });
  await details
    .getByRole("button", { name: "保留我的修改", exact: true })
    .click();
  await details
    .getByRole("button", { name: "保存装备位置", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await api.work.profile({ botId: bot.id })).avatarMedia?.headset.x,
    )
    .toBe(31);
  expect((await api.work.profile({ botId: bot.id })).avatarAssetId).toBe(
    blue.avatarAssetId,
  );

  await details.getByRole("button", { name: "返回", exact: true }).click();
  let reads = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/rpc/work/profile")) reads++;
  });
  const green = await apply("#00ff00");
  await expect(
    page.locator(".chat-header .character-body > image"),
  ).toHaveAttribute("href", green.avatarMedia?.src ?? "");
  expect(reads).toBe(0);
  await details.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(
    details.locator(".avatar-editor .character-body > image"),
  ).toHaveAttribute("href", green.avatarMedia?.src ?? "");
  await expect(name).toHaveValue("Retained name");
  await expect(save).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("profile-current.png") });
});

test("profile conflicts refresh after a racing write and uncertain saves reuse the issued request", async ({
  page,
  service,
}) => {
  test.setTimeout(60000);
  const api = createORPCClient<typeof appClient>(
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  const bot = (await api.bots.list())[0];
  if (!bot) throw new Error("Bot missing");
  await page.goto(service.url);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const details = page.locator("#bot-details");
  await details.getByRole("button", { name: "编辑", exact: true }).click();
  const name = details.getByRole("textbox", { name: "名字", exact: true });
  const save = details.getByRole("button", { name: "保存身份", exact: true });
  await name.fill("Mine");
  let race = true;
  let loseResponse = false;
  const issued: string[] = [];
  await page.route("**/rpc/work/update", async (route) => {
    issued.push(route.request().postData() ?? "");
    if (race) {
      race = false;
      const current = await api.work.profile({ botId: bot.id });
      await api.work.identity({
        botId: bot.id,
        name: "Theirs",
        revision: current.revision,
        requestId: crypto.randomUUID(),
      });
    }
    const response = await route.fetch();
    if (loseResponse) {
      loseResponse = false;
      await route.abort();
    } else await route.fulfill({ response });
  });
  await save.click();
  await expect(page.locator(".attention-toast[data-error]")).toContainText(
    "内容已更新",
  );
  await expect(name).toHaveValue("Mine");
  await expect(save).toBeDisabled();
  await details
    .getByRole("button", { name: "保留我的修改", exact: true })
    .click();
  await save.click();
  await expect(save).toHaveCount(0);
  expect((await api.work.profile({ botId: bot.id })).name).toBe("Mine");
  await name.fill("Confirmed after retry");
  loseResponse = true;
  await save.click();
  await expect(page.locator(".attention-toast[data-error]")).toBeVisible();
  const original = issued.at(-1);
  await page
    .locator(".attention-toast[data-error]")
    .getByRole("button", { name: "重试", exact: true })
    .click();
  await expect(page.locator(".attention-toast[data-error]")).toHaveCount(0);
  expect(issued.at(-1)).toBe(original);
  await expect(save).toHaveCount(0);
  const latest = await api.work.profile({ botId: bot.id });
  await api.work.identity({
    botId: bot.id,
    name: "Latest name",
    revision: latest.revision,
    requestId: crypto.randomUUID(),
  });
  await expect(name).toHaveValue("Latest name");
  await expect(save).toHaveCount(0);
});

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
    useOriginal: true,
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
