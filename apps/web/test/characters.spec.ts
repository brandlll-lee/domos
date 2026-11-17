import { createRequire } from "node:module";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { expect } from "@playwright/test";
import type { client as appClient } from "../src/client.ts";
import { test } from "./fixtures/service.ts";

const sharp = createRequire(
  new URL("../../../packages/agent/package.json", import.meta.url),
)("sharp");

test("custom theme colors validate, save and survive restart in both themes", async ({
  page,
  service,
}, info) => {
  const api = createORPCClient<typeof appClient>(
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  const bot = (await api.bots.list())[0];
  if (!bot) throw new Error("Bot missing");
  await page.goto(service.url);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const details = page.locator("#bot-details");
  await details.getByRole("button", { name: "编辑", exact: true }).click();
  const colors = details.getByRole("group", { name: "主题色", exact: true });
  const hex = colors.getByRole("textbox", { name: "HEX", exact: true });
  const native = colors.getByLabel("自定义颜色", { exact: true });
  const preview = details.locator(".avatar-preview > .bot-avatar");
  const original = await preview.getAttribute("data-seed");
  await hex.fill("#12zz");
  await expect(hex).toHaveAttribute("aria-invalid", "true");
  await expect(colors.getByText("请输入 # 和六位十六进制颜色")).toBeVisible();
  await expect(preview).toHaveAttribute("data-seed", original ?? "");
  await details.getByLabel("名字", { exact: true }).fill("Custom theme");
  await details.getByRole("button", { name: "保存身份", exact: true }).click();
  await expect(hex).toBeFocused();
  expect((await api.work.profile({ botId: bot.id })).name).toBe(bot.name);
  await hex.fill("#73479F");
  await expect(hex).toHaveValue("#73479f");
  await expect(hex).toBeFocused();
  await expect(native).toHaveValue("#73479f");
  await native.evaluate((node: HTMLInputElement) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(node, "#123456");
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(hex).toHaveValue("#123456");
  await colors.getByRole("button", { name: "颜色：晴蓝", exact: true }).click();
  await expect(hex).toHaveValue("#659fff");
  await hex.fill("#73479f");
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({
      width: theme === "light" ? 1360 : 390,
      height: 900,
    });
    await expect
      .poll(() =>
        colors.evaluate((node) => node.scrollWidth <= node.clientWidth),
      )
      .toBe(true);
    await native.focus();
    await expect(native).toBeFocused();
    await colors.screenshot({
      path: info.outputPath(`theme-colors-${theme}.png`),
    });
  }
  await details.getByRole("button", { name: "保存身份", exact: true }).click();
  await expect(
    details.getByRole("button", { name: "保存身份", exact: true }),
  ).toHaveCount(0);
  expect((await api.work.profile({ botId: bot.id })).avatar).toContain(
    "73479f000000",
  );
  const port = Number(new URL(service.url).port);
  await service.stop();
  await service.start(port);
  await page.reload();
  await expect(hex).toHaveValue("#73479f");
  await expect(page.locator(".chat-surface")).toHaveCSS(
    "--bot-color",
    "#73479f",
  );
});

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
    details.locator(".avatar-editor .avatar-preview .character-body > image"),
  ).toHaveAttribute("href", yellow.avatarMedia?.src ?? "");
  await expect(
    details.locator(".equipment-editor .character-body > image"),
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

  await details.getByRole("tab", { name: "我的角色", exact: true }).click();
  const catalog = await api.bots.characters({ botId: bot.id });
  const yellowAsset = catalog.find((item) => item.id === yellow.avatarAssetId);
  const blueAsset = catalog.find((item) => item.id === blue.avatarAssetId);
  if (!yellowAsset || !blueAsset) throw new Error("Characters missing");
  const choices = details.getByRole("button", { name: /^角色：/ });
  await choices
    .filter({ has: page.locator(`image[href="${yellowAsset.media.cover}"]`) })
    .click();
  await expect(
    details.getByRole("spinbutton", { name: "耳机水平", exact: true }),
  ).toHaveValue("23");
  await expect(
    details.locator(".equipment-editor .character-body > image"),
  ).toHaveAttribute("href", yellowAsset.media.cover);
  await details
    .getByRole("spinbutton", { name: "耳机水平", exact: true })
    .fill("29");
  await name.fill("Unsaved name");
  await details
    .getByRole("button", { name: "保存角色与装备", exact: true })
    .click();
  await expect(
    details.getByRole("button", { name: "保存装备位置", exact: true }),
  ).toBeDisabled();
  expect((await api.work.profile({ botId: bot.id })).name).toBe(
    "Retained name",
  );
  await expect(name).toHaveValue("Unsaved name");
  await name.fill("Retained name");
  await choices
    .filter({ has: page.locator(`image[href="${blueAsset.media.cover}"]`) })
    .click();
  await expect(
    details.getByRole("spinbutton", { name: "耳机水平", exact: true }),
  ).toHaveValue("31");
  await save.click();
  await expect(save).toHaveCount(0);

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
    details.locator(".avatar-editor .avatar-preview .character-body > image"),
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
  await page.getByRole("button", { name: "颜色：晴蓝", exact: true }).click();
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
  await page.getByRole("tab", { name: "我的角色", exact: true }).click();
  await page
    .getByRole("button", { name: "角色：黄色角色", exact: true })
    .click();
  await page.getByRole("button", { name: "颜色：翡翠绿", exact: true }).click();
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
  await page.getByRole("tab", { name: "内置角色", exact: true }).click();
  await page.getByRole("button", { name: "外形：圆球", exact: true }).click();
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
