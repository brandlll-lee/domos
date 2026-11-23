import { createRequire } from "node:module";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { expect, type Page } from "@playwright/test";
import type { AppRouter } from "../../api/src/router.ts";
import { chooseAppearance, openDetails } from "./fixtures/chat-ui.ts";
import { test } from "./fixtures/service.ts";

const sharp = createRequire(
  new URL("../../../packages/agent/package.json", import.meta.url),
)("sharp");

async function openConversations(page: Page) {
  await expect(page.locator(".workspace")).toBeVisible();
  const contacts = page.getByRole("button", { name: "联系人", exact: true });
  const sidebar = page.locator('.workspace-panel[data-side="sidebar"]');
  if ((await sidebar.getAttribute("data-closed")) !== null)
    await contacts.click();
  await expect(page.locator(".bot-conversations").first()).toBeVisible();
  await page.getByRole("button", { name: "Domos", exact: true }).click();
  await page.getByRole("menuitem", { name: "管理会话", exact: true }).click();
  return page.getByRole("dialog", { name: "Domos 的会话", exact: true });
}

async function createConversation(page: Page) {
  await page.getByRole("button", { name: "Domos", exact: true }).click();
  await page.getByRole("menuitem", { name: "新建会话", exact: true }).click();
}

test("avatar menus retain their character through hover and sidebar changes", async ({
  service,
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const client = createORPCClient<RouterClient<AppRouter>>(
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  for (let i = 0; i < 25; i++) {
    const { id } = await client.conversations.create({
      botId: 1,
      source: 1,
      requestId: crypto.randomUUID(),
    });
    await client.conversations.update({
      botId: 1,
      id,
      title: `会话 ${i} 的长标题需要保持在浮层内部并自动截断`,
    });
  }
  await page.goto(service.url);
  const trigger = page.getByRole("button", { name: "Domos", exact: true });
  const menu = page.getByRole("menu", { name: "Domos", exact: true });
  await trigger.hover();
  await expect(menu).toBeVisible();
  await expect(trigger.locator(".bot-avatar")).toBeVisible();
  const avatar = await trigger.locator(".bot-avatar").elementHandle();
  const box = await trigger.boundingBox();
  const popup = await menu.boundingBox();
  expect(popup?.width).toBe(340);
  expect(popup && box && popup.x >= box.x + box.width).toBe(true);
  expect(Math.abs((popup?.y ?? 0) - (box?.y ?? 0))).toBeLessThan(2);
  expect(
    await menu
      .locator(".scroll-viewport")
      .evaluate((node) => node.scrollHeight > node.clientHeight),
  ).toBe(true);
  expect(
    await menu.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await expect(
    menu.locator('.engine-mark[data-provider="pi"]').first(),
  ).toBeVisible();
  await menu.getByRole("menuitem", { name: "管理会话", exact: true }).hover();
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.getByRole("separator", { name: "调整联系人宽度" }).press("Home");
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await trigger.hover();
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    expect(
      await trigger
        .locator(".bot-avatar")
        .evaluate((node, saved) => node === saved, avatar),
    ).toBe(true);
    await expect(trigger.locator(".bot-avatar")).toBeVisible();
    await menu.getByRole("menuitem", { name: "管理会话", exact: true }).hover();
    await page.screenshot({
      path: info.outputPath(`avatar-menu-${theme}.png`),
    });
    await page.keyboard.press("Escape");
    await page.mouse.move(700, 40);
  }
  await page
    .getByRole("separator", { name: "调整联系人宽度" })
    .press("ArrowRight");
  expect(
    await trigger
      .locator(".bot-avatar")
      .evaluate((node, saved) => node === saved, avatar),
  ).toBe(true);
  await trigger.press("ArrowDown");
  await expect(
    menu.getByRole("menuitem", { name: "新建会话", exact: true }),
  ).toBeFocused();
  await menu.getByRole("menuitem", { name: "管理会话", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Domos 的会话", exact: true }),
  ).toBeVisible();
});

test("three conversations keep drafts, configuration and history through navigation and restart", async ({
  service,
  page,
}) => {
  const client = createORPCClient<RouterClient<AppRouter>>(
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  await page.goto(service.url);
  const input = page.getByLabel("消息", { exact: true });
  await input.fill("原有草稿");
  await createConversation(page);
  await expect(page).toHaveURL(/#bot\/1\/\d+$/);
  const second = Number(new URL(page.url()).hash.split("/").at(-1));
  expect(second).not.toBe(1);
  await expect(input).toHaveText("");
  const details = await openDetails(page);
  await details.getByRole("combobox", { name: "模型", exact: true }).click();
  await page
    .getByRole("option", { name: "Pi · 测试模型二", exact: true })
    .click();
  await input.fill("准备面试");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByLabel("Domos 的回复")).toContainText("准备面试");
  await input.fill("面试草稿");
  await createConversation(page);
  await expect(page).not.toHaveURL(new RegExp(`#bot/1/${second}$`));
  const third = Number(new URL(page.url()).hash.split("/").at(-1));
  await expect(input).toHaveText("");
  await input.fill("分析账单");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByLabel("Domos 的回复")).toContainText("分析账单");
  await expect(page.getByLabel("Domos 的回复")).toContainText("faux-2");
  await page
    .locator(`.conversation-children a[href="#bot/1/${second}"]`)
    .click();
  await expect(input).toHaveText("面试草稿");
  await expect(page.getByLabel("你的消息")).toHaveCount(1);
  await expect(page.getByLabel("你的消息")).toContainText("准备面试");
  await page.locator('.conversation-children a[href="#bot/1/1"]').click();
  await expect(input).toHaveText("原有草稿");
  await expect(
    page.getByRole("combobox", { name: "模型", exact: true }),
  ).toContainText("测试模型一");
  await expect(page.getByLabel("你的消息")).toHaveCount(0);
  await page
    .locator(`.conversation-children a[href="#bot/1/${third}"]`)
    .click();
  await page.reload();
  await expect(page.getByLabel("你的消息")).toContainText("分析账单");
  const dialog = await openConversations(page);
  await dialog
    .getByRole("button", { name: "准备面试的操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
  await page.getByLabel("名称", { exact: true }).fill("面试资料");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await dialog.getByLabel("搜索会话", { exact: true }).fill("面试");
  await expect(dialog.locator(".command-row")).toHaveCount(1);
  await dialog
    .getByRole("button", { name: "面试资料的操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "归档", exact: true }).click();
  await expect(dialog.locator(".command-row")).toHaveCount(0);
  await dialog.getByRole("tab", { name: "已归档", exact: true }).click();
  await expect(dialog.locator(".command-row")).toHaveCount(1);
  await dialog
    .getByRole("button", { name: "面试资料的操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "恢复会话", exact: true }).click();
  await dialog.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await chooseAppearance(page, "深色");
  await page.screenshot({ path: "test-results/conversations-dark.png" });
  await chooseAppearance(page, "浅色");
  await page.screenshot({ path: "test-results/conversations-light.png" });
  await page.setViewportSize({ width: 620, height: 800 });
  await expect(
    page.locator('.workspace-panel[data-side="inspector"][data-modal]'),
  ).toBeVisible();
  await page
    .locator('.workspace-panel[data-side="inspector"]')
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await openConversations(page);
  await expect(
    page.getByRole("dialog", { name: "Domos 的会话", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/conversations-narrow.png" });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭弹窗", exact: true })
    .click();
  const port = Number(new URL(service.url).port);
  await service.stop();
  await service.start(port);
  await expect(page.getByLabel("你的消息")).toContainText("分析账单");
  expect((await client.get({ botId: second })).messages.length).toBeGreaterThan(
    0,
  );
});

test("switching away keeps work alive and Stop targets the queued conversation", async ({
  service,
  page,
}) => {
  await page.goto(service.url);
  await service.control("gate");
  const input = page.getByLabel("消息", { exact: true });
  await input.fill("做网站");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await service.control("wait-model");
  await createConversation(page);
  await expect(input).toHaveText("");
  await input.fill("准备面试");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const list = page.getByRole("navigation", { name: "Domos的会话列表" });
  await expect(list.locator('[title="排队中"]')).toBeVisible();
  await page.getByRole("button", { name: "停止生成", exact: true }).click();
  await expect(list.locator('[title="工作中"]')).toBeVisible();
  await expect(list.locator('[title="工作中"] .loading-dots')).toBeVisible();
  await expect(list.locator('[title="排队中"]')).toHaveCount(0);
  await service.control("release");
  await expect(list.getByRole("img", { name: "未读" })).toBeVisible();
  await expect(list.getByRole("link").first()).toHaveAttribute(
    "href",
    "#bot/1/1",
  );
  await page.locator('.conversation-children a[href="#bot/1/1"]').click();
  await expect(page.getByLabel("Domos 的回复")).toContainText("做网站");
});

test("conversation marks keep their slot through failure, work, unread and completion", async ({
  service,
  page,
}, info) => {
  await page.goto(service.url);
  const original = page.locator('.conversation-children a[href="#bot/1/1"]');
  const title = original.locator(".conversation-row-title");
  await expect(
    original.locator('.engine-mark[data-provider="pi"]'),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "为 Domos 新建会话", exact: true }),
  ).toHaveCount(0);
  const titleInset = () => title.evaluate((el: HTMLElement) => el.offsetLeft);
  const left = await titleInset();
  await service.control({
    records: [],
    run: {
      turnId: "failed-turn",
      provider: "pi",
      model: null,
      startedAt: Date.now(),
      endedAt: Date.now(),
      status: "failed",
    },
  });
  const failed = original.locator('[data-status="failed"]');
  for (const appearance of ["浅色", "深色"] as const) {
    await chooseAppearance(page, appearance);
    await expect(failed.getByRole("img", { name: /^失败/ })).toBeVisible();
    await expect(failed).toHaveCSS("border-radius", "999px");
    expect(
      await failed.evaluate((el) => getComputedStyle(el).backgroundColor),
    ).not.toBe("rgba(0, 0, 0, 0)");
    expect(await titleInset()).toBe(left);
    await page.getByRole("button", { name: "Domos", exact: true }).hover();
    const menu = page.getByRole("menu", { name: "Domos", exact: true });
    await expect(menu.getByRole("img", { name: /^失败/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.screenshot({
      path: info.outputPath(`conversation-marks-${appearance}.png`),
    });
  }
  await service.control("gate");
  await page.getByLabel("消息", { exact: true }).fill("处理资料");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await service.control("wait-model");
  const dots = original.locator(".loading-dots");
  await expect(dots).toBeVisible();
  await page.getByRole("button", { name: "Domos", exact: true }).hover();
  await expect(
    page
      .getByRole("menu", { name: "Domos", exact: true })
      .locator(".conversation-status .loading-dots"),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dots.locator("g").first()).toHaveCSS(
    "animation-name",
    "loading-wave",
  );
  await expect(page.locator(".typing-dots > .loading-dots")).toBeVisible();
  expect(await titleInset()).toBe(left);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(dots.locator("g").first()).toHaveCSS("animation-name", "none");
  await createConversation(page);
  await service.control({
    sessionId: 1,
    records: [
      {
        id: "published-result",
        turnId: "published-turn",
        role: "assistant",
        stopped: false,
        content: [
          { type: "text", key: "published-text", text: "第一份资料已完成" },
        ],
      },
    ],
  });
  const avatar = page
    .getByRole("button", { name: "Domos", exact: true })
    .locator(".bot-avatar");
  await expect(avatar.locator(".loading-dots")).toBeVisible();
  await expect(avatar.locator(".unread-badge")).toBeVisible();
  const work = await avatar.locator(".loading-dots").boundingBox();
  const unread = await avatar.locator(".unread-badge").boundingBox();
  expect(work && unread && work.y >= unread.y + unread.height).toBe(true);
  await service.control("release");
  await expect(avatar.locator(".loading-dots")).toHaveCount(0);
  await expect(
    original.getByRole("img", { name: "未读", exact: true }),
  ).toBeVisible();
  await original.click();
  await expect(
    original.locator('.engine-mark[data-provider="pi"]'),
  ).toBeVisible();
});

test("the sidebar highlights its Bot and current conversation and aligns their icon centers", async ({
  service,
  page,
}) => {
  const client = createORPCClient<RouterClient<AppRouter>>(
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  await client.conversations.update({ botId: 1, id: 1, title: "原有计划" });
  for (const title of ["访谈纪要", "预算复核", "活动方案", "周报"]) {
    const { id } = await client.conversations.create({
      botId: 1,
      source: 1,
      requestId: crypto.randomUUID(),
    });
    await client.conversations.update({ botId: 1, id, title });
  }
  await page.goto(`${service.url}/#bot/1/1`);
  const sidebar = page.getByRole("navigation", { name: "联系人", exact: true });
  const parent = sidebar.getByRole("link", { name: "Domos", exact: true });
  const current = sidebar.locator('[aria-current="page"]');
  const list = sidebar.getByRole("navigation", { name: "Domos的会话列表" });
  const arrow = sidebar.getByRole("button", {
    name: "Domos的会话",
    exact: true,
  });
  const titles = list.locator(".conversation-row-title");
  await expect(titles).toHaveText(["周报", "活动方案", "原有计划"]);
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText("原有计划");
  await expect(current).toHaveCSS("min-height", "32px");
  await expect(current).toHaveCSS("height", "32px");
  await expect(current.locator(".conversation-status")).toHaveCSS(
    "transform",
    "matrix(0.875, 0, 0, 0.875, 0, 0)",
  );
  await expect(list).toHaveCSS("border-inline-start-width", "0px");
  const parentBox = await parent.boundingBox();
  const currentBox = await current.boundingBox();
  expect(currentBox?.x).toBe(parentBox?.x);
  expect(currentBox?.width).toBe(parentBox?.width);
  for (const theme of ["light", "dark"] as const) {
    await chooseAppearance(page, theme === "light" ? "浅色" : "深色");
    await parent.hover();
    await expect(parent).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const heading = parent.locator("..");
    expect(
      await heading.evaluate((row) => getComputedStyle(row).backgroundColor),
    ).not.toBe("rgba(0, 0, 0, 0)");
    const avatarBox = await heading.locator(".bot-menu-trigger").boundingBox();
    const iconBox = await current.locator(".conversation-status").boundingBox();
    expect(
      avatarBox &&
        iconBox &&
        Math.abs(
          avatarBox.x + avatarBox.width / 2 - iconBox.x - iconBox.width / 2,
        ),
    ).toBeLessThan(0.5);
    const selected = await current.evaluate(
      (row) => getComputedStyle(row).backgroundColor,
    );
    expect(selected).not.toBe("rgba(0, 0, 0, 0)");
    await parent.focus();
    await page.keyboard.press("Tab");
    await expect(arrow).toBeFocused();
    await expect(arrow).toHaveAttribute("aria-expanded", "true");
    await expect(arrow.locator("svg")).toHaveCSS("rotate", "none");
    await page.keyboard.press("ArrowLeft");
    await expect(list).toBeHidden();
    await expect(arrow).toHaveAttribute("aria-expanded", "false");
    await expect(arrow.locator("svg")).toHaveCSS("rotate", "-90deg");
    await expect(current).toHaveCount(1);
    await expect(parent.locator("..")).toHaveAttribute("data-current", "true");
    await expect(page).toHaveURL(/#bot\/1\/1$/);
    await page.keyboard.press("ArrowRight");
    await expect(arrow.locator("svg")).toHaveCSS("rotate", "none");
    await expect(current).toHaveText("原有计划");
  }
  await list.getByRole("button", { name: "展开其余 2 条" }).press("Enter");
  await expect(titles).toHaveText([
    "周报",
    "活动方案",
    "预算复核",
    "访谈纪要",
    "原有计划",
  ]);
  await list.getByRole("button", { name: "收起其余会话" }).press("Space");
  await expect(titles).toHaveText(["周报", "活动方案", "原有计划"]);
  await list.getByRole("button", { name: "展开其余 2 条" }).press("Enter");
  await list.getByRole("link", { name: /^访谈纪要/ }).press("Enter");
  await expect(parent).toContainText("访谈纪要");
  await expect(titles).toHaveText(["周报", "活动方案", "访谈纪要"]);
  await expect(current).toHaveCount(1);
  await expect(current).toContainText("访谈纪要");
  await parent.press("Enter");
  await expect(current).toContainText("访谈纪要");
});

test("conversation palette fits its rows and keeps management and keyboard actions separate", async ({
  service,
  page,
}, info) => {
  test.setTimeout(60_000);
  const client = createORPCClient<RouterClient<AppRouter>>(
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  await page.goto(service.url);
  let dialog = await openConversations(page);
  await expect(dialog.getByRole("searchbox")).toBeFocused();
  await expect(dialog.locator(".command-row")).toHaveCount(1);
  const one = await dialog.boundingBox();
  expect(one?.width).toBe(620);
  expect(one?.height).toBeLessThan(300);
  await page.screenshot({
    path: info.outputPath("conversation-palette-single.png"),
  });
  await expect(
    dialog.getByRole("button", { name: "上一页", exact: true }),
  ).toHaveCount(0);
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await page.keyboard.press("Escape");
  for (let i = 0; i < 2; i++) {
    const item = await client.conversations.create({
      botId: 1,
      source: 1,
      requestId: crypto.randomUUID(),
    });
    await client.conversations.update({
      botId: 1,
      id: item.id,
      title: `资料 ${i}`,
    });
  }
  dialog = await openConversations(page);
  await expect(dialog.locator(".command-row")).toHaveCount(3);
  expect((await dialog.boundingBox())?.height).toBeGreaterThan(
    one?.height ?? 0,
  );
  await dialog.getByRole("searchbox").fill("资料 0");
  await expect(dialog.locator("[data-highlighted]")).toContainText("资料 0");
  const route = page.url();
  await dialog
    .getByRole("button", { name: "资料 0的操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "归档", exact: true }).click();
  await expect(dialog.locator(".command-row")).toHaveCount(0);
  expect(page.url()).toBe(route);
  await dialog.getByRole("tab", { name: "已归档", exact: true }).click();
  await expect(dialog.locator(".command-row")).toHaveCount(1);
  await dialog
    .getByRole("button", { name: "资料 0的操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "恢复会话", exact: true }).click();
  await dialog.getByRole("tab", { name: "活跃", exact: true }).click();
  await dialog.getByRole("searchbox").press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.locator(".chat-identity-conversation")).toHaveText(
    "资料 0",
  );
  await expect(page.locator(".chat-header")).toHaveCSS("min-height", "124px");
  for (let i = 2; i < 27; i++) {
    const item = await client.conversations.create({
      botId: 1,
      source: 1,
      requestId: crypto.randomUUID(),
    });
    await client.conversations.update({
      botId: 1,
      id: item.id,
      title: `资料 ${i}`,
    });
  }
  dialog = await openConversations(page);
  await expect(dialog.locator(".command-row")).toHaveCount(28);
  await expect(dialog.locator('[aria-current="page"]')).toBeInViewport();
  const scroll = dialog.locator(".scroll-viewport");
  expect(
    await scroll.evaluate((node) => node.scrollHeight > node.clientHeight),
  ).toBe(true);
  for (const appearance of ["light", "dark"] as const) {
    await page.keyboard.press("Escape");
    await page.emulateMedia({ colorScheme: appearance });
    dialog = await openConversations(page);
    expect((await dialog.boundingBox())?.height).toBeLessThanOrEqual(630);
    await dialog.getByRole("searchbox").press("ArrowDown");
    await expect(dialog.getByRole("searchbox")).toBeFocused();
    await page.screenshot({
      path: info.outputPath(`conversation-palette-${appearance}.png`),
    });
  }
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".workspace")).toHaveAttribute(
    "data-mobile",
    "true",
  );
  const inspector = page.locator(
    '.workspace-panel[data-side="inspector"][data-modal]',
  );
  if (await inspector.isVisible()) {
    await inspector.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(inspector).toBeHidden();
  }
  dialog = await openConversations(page);
  expect((await dialog.boundingBox())?.width).toBeLessThan(390);
  expect((await dialog.boundingBox())?.height).toBeLessThanOrEqual(591);
  await page.screenshot({
    path: info.outputPath("conversation-palette-narrow.png"),
  });
});

test("search palette shows recent conversations and keeps its active result visible while typing", async ({
  service,
  page,
}, info) => {
  const client = createORPCClient<RouterClient<AppRouter>>(
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  const second = await client.conversations.create({
    botId: 1,
    source: 1,
    requestId: crypto.randomUUID(),
  });
  await client.conversations.update({
    botId: 1,
    id: second.id,
    title: "发布计划",
  });
  await page.goto(service.url);
  const trigger = page.getByRole("button", {
    name: "搜索联系人和聊天记录",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "搜索", exact: true });
  const input = dialog.getByRole("searchbox");
  await expect(input).toBeFocused();
  await expect(
    dialog.getByRole("rowgroup", { name: "最近会话" }),
  ).toContainText("发布计划");
  await expect(dialog.locator("[data-highlighted]")).toHaveCount(1);
  await expect(dialog.locator("[data-highlighted]")).toContainText("开始对话");
  const first = await input.getAttribute("aria-activedescendant");
  const firstRow = dialog.locator(".command-row").first();
  await firstRow.getByRole("button").hover();
  await input.press("ArrowDown");
  await expect(input).toBeFocused();
  await expect(input).not.toHaveAttribute("aria-activedescendant", first ?? "");
  await expect(dialog.locator(".command-row[data-highlighted]")).toHaveCount(1);
  await expect(firstRow).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(firstRow.getByRole("button")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  const recent = dialog.getByRole("button", {
    name: "Domos：发布计划",
    exact: true,
  });
  await recent.hover();
  await expect(dialog.locator("[data-highlighted]")).toContainText("发布计划");
  await input.press("Enter");
  await expect(page).toHaveURL(new RegExp(`#bot/1/${second.id}$`));
  await expect(dialog).toBeHidden();
  await trigger.click();
  await expect(dialog.locator("[data-highlighted]")).toContainText("开始对话");
  await input.fill("没有匹配的名称");
  await expect(dialog.locator("[data-highlighted]")).toHaveCount(0);
  await input.press("Enter");
  await expect(dialog).toBeVisible();
  await input.clear();
  for (const appearance of ["light", "dark"] as const) {
    await input.press("Escape");
    await page.emulateMedia({ colorScheme: appearance });
    await trigger.click();
    await expect(dialog).toHaveCSS("opacity", "1");
    expect((await dialog.boundingBox())?.height).toBeLessThan(400);
    await page.screenshot({
      path: info.outputPath(`search-palette-${appearance}.png`),
    });
  }
  await input.press("Escape");
  await expect(trigger).toBeFocused();
});

test("command rows own one highlight and keep menu focus and identity alignment", async ({
  service,
  page,
}, info) => {
  const api = createORPCClient<RouterClient<AppRouter>>(
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  await api.conversations.create({
    botId: 1,
    source: 1,
    requestId: crypto.randomUUID(),
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(service.url);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const dialog = await openConversations(page);
    const rows = dialog.locator(".command-row");
    const first = rows.first();
    const second = rows.nth(1);
    const input = dialog.getByRole("searchbox");
    await expect(dialog.locator(".command-search")).toHaveCSS(
      "border-top-width",
      "0px",
    );
    await expect(dialog.locator(".command-search")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await first.locator("[data-command-action]").hover();
    await expect(first.locator("[data-command-action]")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await input.press("ArrowDown");
    await expect(first).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(second).toHaveAttribute("data-highlighted");
    await expect(dialog.locator(".command-row[data-highlighted]")).toHaveCount(
      1,
    );
    const menu = second.locator(".command-row-actions button");
    await menu.hover();
    await expect(menu).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    const box = await first.boundingBox();
    if (!box) throw new Error("Command row missing");
    await page.mouse.move(box.x + 20, box.y + box.height / 2);
    await expect(second).toHaveAttribute("data-highlighted");
    await expect(dialog.locator(".command-row[data-highlighted]")).toHaveCount(
      1,
    );
    await page.keyboard.press("ArrowDown");
    await expect(second).toHaveAttribute("data-highlighted");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(menu).toBeFocused();
    await input.press("ArrowUp");
    await expect(input).toBeFocused();
    await expect(first).toHaveAttribute("data-highlighted");
    const identity = dialog.locator(".conversation-dialog-identity");
    const avatar = identity.locator(".bot-avatar");
    await expect(avatar).toHaveCSS("width", "32px");
    await expect(avatar).toHaveCSS("height", "32px");
    await expect(avatar.locator("svg.character")).toHaveCSS("width", "32px");
    await expect(avatar.locator("svg.character")).toHaveCSS("height", "32px");
    const avatarBox = await avatar.boundingBox();
    const titleBox = await identity
      .locator(":scope > span:last-child")
      .boundingBox();
    if (!avatarBox || !titleBox) throw new Error("Identity missing");
    expect(avatarBox.y + avatarBox.height / 2).toBeCloseTo(
      titleBox.y + titleBox.height / 2,
      0,
    );
    await expect(
      dialog.getByRole("button", { name: "关闭弹窗" }).locator("svg"),
    ).toHaveCSS("width", "16px");
    await dialog.screenshot({
      path: info.outputPath(`command-interaction-${colorScheme}.png`),
    });
    await input.press("Escape");
  }
  const file = await api.files.upload({
    botId: 1,
    file: new File(
      [
        await sharp({
          create: { width: 32, height: 32, channels: 4, background: "#659fff" },
        })
          .png()
          .toBuffer(),
      ],
      "avatar.png",
      { type: "image/png" },
    ),
  });
  const profile = await api.work.profile({ botId: 1 });
  const custom = await api.work.identity({
    botId: 1,
    avatarFileId: file.id,
    coverFileId: file.id,
    useOriginal: true,
    revision: profile.revision,
    requestId: crypto.randomUUID(),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".workspace")).toHaveAttribute(
    "data-mobile",
    "true",
  );
  const inspector = page.locator(
    '.workspace-panel[data-side="inspector"][data-modal]',
  );
  if (await inspector.isVisible()) {
    await inspector.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(inspector).toBeHidden();
  }
  const dialog = await openConversations(page);
  const avatar = dialog.locator(
    ".conversation-dialog-identity .bot-avatar svg.character",
  );
  await expect(avatar).toHaveCSS("width", "32px");
  await expect(avatar).toHaveCSS("height", "32px");
  await expect(avatar.locator(".character-body > image")).toHaveAttribute(
    "href",
    custom.avatarMedia?.thumbnail ?? custom.avatarMedia?.cover ?? "",
  );
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await dialog.screenshot({
    path: info.outputPath("command-custom-avatar-narrow.png"),
  });
});

test.describe("touch navigation", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: "reduce",
  });
  test("users create conversations through the Bot menu", async ({
    service,
    page,
  }) => {
    await page.goto(service.url);
    await expect(page.locator(".workspace")).toHaveAttribute(
      "data-mobile",
      "true",
    );
    await page.getByRole("button", { name: "联系人", exact: true }).tap();
    const menu = page.getByRole("button", {
      name: "Domos",
      exact: true,
    });
    await expect(menu).toBeVisible();
    await menu.tap();
    const popup = page.getByRole("menu", { name: "Domos", exact: true });
    await expect(popup).toBeVisible();
    const bounds = await popup.boundingBox();
    expect(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390).toBe(
      true,
    );
    await page.getByRole("menuitem", { name: "新建会话", exact: true }).tap();
    await expect(page).toHaveURL(/#bot\/1\/\d+$/);
    await expect(page.locator(".chat-identity-conversation")).toHaveText(
      "新会话",
    );
    await page.getByRole("button", { name: "联系人", exact: true }).tap();
    await menu.tap();
    await page.getByRole("menuitem", { name: "管理会话", exact: true }).tap();
    const dialog = page.getByRole("dialog", {
      name: "Domos 的会话",
      exact: true,
    });
    const actions = dialog.locator(".command-row-actions").first();
    await expect(actions).toHaveCSS("opacity", "1");
    await actions.getByRole("button").tap();
    await expect(dialog.locator(".command-row[data-highlighted]")).toHaveCount(
      1,
    );
    await page.getByRole("menuitem", { name: "重命名", exact: true }).tap();
    await expect(
      page
        .getByRole("dialog", { name: "会话名称", exact: true })
        .getByRole("textbox", { name: "名称", exact: true }),
    ).toBeFocused();
  });
});
