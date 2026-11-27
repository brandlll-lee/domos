import { writeFile } from "node:fs/promises";
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
  test.setTimeout(60_000);
  const api = createORPCClient<typeof appClient>(
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  const bot = (await api.bots.list())[0];
  if (!bot) throw new Error("Bot missing");
  await page.goto(service.url);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const details = page.locator("#bot-details");
  await details.getByRole("button", { name: "编辑", exact: true }).click();
  await details.getByRole("button", { name: "编辑外观", exact: true }).click();
  await details.getByRole("button", { name: /^主题色 #/ }).click();
  await page
    .getByRole("button", { name: "编辑自定义颜色", exact: true })
    .click();
  const hex = page.getByRole("textbox", { name: "HEX", exact: true });
  const preview = details.locator(".avatar-preview > .bot-avatar");
  const original = await preview.getAttribute("data-seed");
  await hex.fill("12zz");
  await expect(hex).toHaveAttribute("aria-invalid", "true");
  await expect(preview).toHaveAttribute("data-seed", original ?? "");
  await hex.fill("#73479F");
  await expect(hex).toHaveValue("73479F");
  await expect(
    page.getByRole("textbox", { name: "R", exact: true }),
  ).toHaveValue("115");
  await page.getByRole("textbox", { name: "G", exact: true }).fill("0");
  await expect(hex).toHaveValue("73009F");
  await hex.fill("73479F");
  const hue = page.getByRole("slider", { name: "色相", exact: true });
  await hue.focus();
  await hue.press("ArrowRight");
  await expect(hex).not.toHaveValue("73479F");
  const plane = page.getByRole("slider", { name: "饱和度与亮度", exact: true });
  const box = await plane.boundingBox();
  if (!box) throw new Error("Color plane missing");
  const frameTimes = page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const frames: number[] = [];
        const start = performance.now();
        let previous = start;
        function frame(now: number) {
          frames.push(now - previous);
          previous = now;
          if (now - start < 5000) requestAnimationFrame(frame);
          else resolve(frames);
        }
        requestAnimationFrame(frame);
      }),
  );
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  const started = Date.now();
  let step = 0;
  while (Date.now() - started < 5000) {
    await page.mouse.move(
      box.x + box.width * (0.5 + 0.4 * Math.sin(step / 8)),
      box.y + box.height * (0.5 + 0.4 * Math.cos(step / 8)),
    );
    step++;
  }
  await page.mouse.up();
  const frames = (await frameTimes).sort((a, b) => a - b);
  const p95 = frames[Math.floor(frames.length * 0.95)];
  const performancePath = info.outputPath("color-drag.json");
  await writeFile(
    performancePath,
    JSON.stringify({
      durationMs: 5000,
      frames: frames.length,
      p95,
      max: frames.at(-1),
    }),
  );
  await info.attach("color-drag", {
    contentType: "application/json",
    path: performancePath,
  });
  await expect(hex).not.toHaveValue("73479F");
  await hex.fill("73479F");
  await page
    .getByRole("button", { name: "保存当前颜色到位置 1", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("button", { name: "自定义色 #73479f", exact: true }),
  ).toHaveCount(2);
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({
      width: theme === "light" ? 1360 : 390,
      height: 900,
    });
    await expect
      .poll(() =>
        page
          .locator(".color-editor")
          .evaluate((node) => node.scrollWidth <= node.clientWidth),
      )
      .toBe(true);
    await page.screenshot({
      path: info.outputPath(`theme-colors-${theme}.png`),
    });
  }
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await details.getByLabel("名字", { exact: true }).fill("Custom theme");
  await details.getByRole("button", { name: "保存身份", exact: true }).click();
  await expect(
    details.getByRole("button", { name: "保存身份", exact: true }),
  ).toBeDisabled();
  expect((await api.work.profile({ botId: bot.id })).avatar).toContain(
    "73479f000000",
  );
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await details.getByRole("button", { name: "关闭", exact: true }).click();
  const port = Number(new URL(service.url).port);
  await service.stop();
  await service.start(port);
  await page.reload();
  await expect(page.locator(".chat-surface")).toHaveCSS(
    "--bot-color",
    "#73479f",
  );
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await details.getByRole("button", { name: "编辑", exact: true }).click();
  await details.getByRole("button", { name: "编辑外观", exact: true }).click();
  await details.getByRole("button", { name: /^主题色 #/ }).click();
  await expect(
    page.getByRole("button", { name: "自定义色 #73479f", exact: true }),
  ).toBeVisible();
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
  const back = details.getByRole("button", { name: "返回", exact: true });
  const appearance = details.getByRole("button", {
    name: "编辑外观",
    exact: true,
  });
  const equipment = details.getByRole("button", {
    name: "调整耳机与电脑",
    exact: true,
  });
  const horizontal = details.getByRole("spinbutton", {
    name: "水平位置数值",
    exact: true,
  });
  await name.fill("My name");
  const yellow = await apply("#ffff00");
  await expect(
    details.locator(".profile-identity .character-body > image"),
  ).toHaveAttribute("href", yellow.avatarMedia?.src ?? "");
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
    details.getByRole("textbox", { name: "长期指令", exact: true }),
  ).toHaveValue("Remote instructions");
  await save.click();
  await expect(save).toBeDisabled();
  expect(await api.work.profile({ botId: bot.id })).toMatchObject({
    name: "My name",
    instructions: "Remote instructions",
    avatarAssetId: yellow.avatarAssetId,
  });
  await name.fill("Retained name");
  await appearance.click();
  await equipment.click();
  await expect(
    details.locator(".profile-equipment-stage .character-body > image"),
  ).toHaveAttribute("href", yellow.avatarMedia?.cover ?? "");
  await horizontal.fill("23");
  await save.click();
  await expect(save).toBeDisabled();
  expect((await api.work.profile({ botId: bot.id })).name).toBe(
    "Retained name",
  );
  await horizontal.fill("31");
  const blue = await apply("#0000ff");
  await expect(
    details.getByText("耳机位置已在别处更新。请选择要保留的内容。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(save).toBeDisabled();
  await page.screenshot({ path: info.outputPath("equipment-conflict.png") });
  await details
    .getByRole("button", { name: "保留我的修改", exact: true })
    .click();
  await save.click();
  await expect
    .poll(
      async () =>
        (await api.work.profile({ botId: bot.id })).avatarMedia?.headset.x,
    )
    .toBe(31);
  expect((await api.work.profile({ botId: bot.id })).avatarAssetId).toBe(
    blue.avatarAssetId,
  );
  await back.click();
  await details.getByRole("tab", { name: "我的角色", exact: true }).click();
  const catalog = await api.bots.characters({ botId: bot.id });
  const yellowAsset = catalog.find((item) => item.id === yellow.avatarAssetId);
  const blueAsset = catalog.find((item) => item.id === blue.avatarAssetId);
  if (!yellowAsset || !blueAsset) throw new Error("Characters missing");
  const choices = details.getByRole("button", { name: /^角色：/ });
  await choices
    .filter({
      has: page.locator(
        `image[href="${yellowAsset.media.thumbnail ?? yellowAsset.media.cover}"]`,
      ),
    })
    .click();
  await equipment.click();
  await expect(horizontal).toHaveValue("23");
  await horizontal.fill("29");
  await back.click();
  await back.click();
  await name.fill("Unified name");
  await save.click();
  await expect
    .poll(async () => (await api.work.profile({ botId: bot.id })).name)
    .toBe("Unified name");
  expect(
    (await api.work.profile({ botId: bot.id })).avatarMedia?.headset.x,
  ).toBe(29);
  await appearance.click();
  await choices
    .filter({
      has: page.locator(
        `image[href="${blueAsset.media.thumbnail ?? blueAsset.media.cover}"]`,
      ),
    })
    .click();
  await equipment.click();
  await expect(horizontal).toHaveValue("31");
  await save.click();
  await expect(save).toBeDisabled();
  await back.click();
  await back.click();
  await back.click();
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
    details.locator(".profile-identity .character-body > image"),
  ).toHaveAttribute("href", green.avatarMedia?.src ?? "");
  await expect(name).toHaveValue("Unified name");
  await expect(save).toBeDisabled();
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
  await expect(save).toBeDisabled();
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
  await expect(save).toBeDisabled();
  const latest = await api.work.profile({ botId: bot.id });
  await api.work.identity({
    botId: bot.id,
    name: "Latest name",
    revision: latest.revision,
    requestId: crypto.randomUUID(),
  });
  await expect(name).toHaveValue("Latest name");
  await expect(save).toBeDisabled();
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
  await details.getByRole("button", { name: "编辑外观", exact: true }).click();
  await details.getByRole("button", { name: /^主题色 #/ }).click();
  await page.getByRole("button", { name: "颜色：晴蓝", exact: true }).click();
  await page.keyboard.press("Escape");
  await details.getByRole("button", { name: "返回", exact: true }).click();
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
  const dialog = page.locator(".create-bot-dialog");
  await dialog.getByRole("button", { name: "编辑外观", exact: true }).click();
  await page.getByRole("tab", { name: "我的角色", exact: true }).click();
  await page
    .getByRole("button", { name: "角色：黄色角色", exact: true })
    .click();
  await dialog.getByRole("button", { name: /^主题色 #/ }).click();
  await page.getByRole("button", { name: "颜色：翡翠绿", exact: true }).click();
  await page.keyboard.press("Escape");
  await dialog
    .getByRole("button", { name: "调整耳机与电脑", exact: true })
    .click();
  await dialog
    .getByRole("spinbutton", { name: "水平位置数值", exact: true })
    .fill("34");
  await dialog.getByRole("button", { name: "返回", exact: true }).click();
  await dialog.getByRole("button", { name: "返回", exact: true }).click();
  await dialog.getByLabel("名字", { exact: true }).fill("复用角色");
  await page.screenshot({ path: "test-results/character-create-picker.png" });
  const equipmentRequests: string[] = [];
  await page.route("**/rpc/work/update", async (route) => {
    equipmentRequests.push(route.request().postData() ?? "");
    if (equipmentRequests.length === 1) {
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await dialog
    .getByRole("button", { name: "创建并选择模型", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("创建未确认");
  await dialog
    .getByRole("button", { name: "创建并选择模型", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Pi", exact: true }).click();
  expect(equipmentRequests).toHaveLength(2);
  expect(equipmentRequests[1]).toBe(equipmentRequests[0]);
  await page.unroute("**/rpc/work/update");
  await dialog.getByRole("combobox", { name: "模型", exact: true }).click();
  await page
    .getByRole("option", { name: "Pi · 测试模型一", exact: true })
    .click();
  await dialog.getByRole("button", { name: "开始聊天", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const second = (await api.bots.list()).find((bot) => bot.name === "复用角色");
  if (!second) throw new Error("Second Bot missing");
  expect(second.avatarAssetId).toBe(applied.avatarAssetId);
  expect(second.avatarMedia?.headset.x).toBe(34);
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
  await details.getByRole("button", { name: "编辑外观", exact: true }).click();
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
