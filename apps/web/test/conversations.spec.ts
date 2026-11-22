import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { expect, type Page } from "@playwright/test";
import type { AppRouter } from "../../api/src/router.ts";
import { chooseAppearance, openDetails } from "./fixtures/chat-ui.ts";
import { test } from "./fixtures/service.ts";

async function createConversation(page: Page) {
  await page.getByRole("button", { name: "当前会话", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Domos的会话" });
  await dialog.getByRole("button", { name: "新建会话", exact: true }).click();
  await expect(dialog).toBeHidden();
}

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
  await page.getByRole("button", { name: "当前会话", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Domos的会话", exact: true });
  await dialog
    .getByRole("button", { name: "准备面试的操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
  await page.getByLabel("名称", { exact: true }).fill("面试资料");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await dialog.getByLabel("搜索会话", { exact: true }).fill("面试");
  await expect(dialog.locator(".conversation-list-row")).toHaveCount(1);
  await dialog
    .getByRole("button", { name: "面试资料的操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "归档", exact: true }).click();
  await expect(dialog.locator(".conversation-list-row")).toHaveCount(0);
  await dialog.getByLabel("已归档", { exact: true }).check();
  await expect(dialog.locator(".conversation-list-row")).toHaveCount(1);
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
  await page.getByRole("button", { name: "当前会话", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Domos的会话", exact: true }),
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
  await service.control("release");
  await expect(list.getByRole("img", { name: "未读" })).toBeVisible();
  await expect(list.getByRole("link").first()).toHaveAttribute(
    "href",
    "#bot/1/1",
  );
  await page.locator('.conversation-children a[href="#bot/1/1"]').click();
  await expect(page.getByLabel("Domos 的回复")).toContainText("做网站");
});

test("the sidebar keeps one current row and reveals older conversations in place", async ({
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
  await expect(list).toHaveCSS("border-inline-start-width", "0px");
  const parentBox = await parent.boundingBox();
  const currentBox = await current.boundingBox();
  expect(currentBox?.x).toBe(parentBox?.x);
  expect(currentBox?.width).toBe(parentBox?.width);
  for (const theme of ["light", "dark"] as const) {
    await chooseAppearance(page, theme === "light" ? "浅色" : "深色");
    await parent.hover();
    await expect(parent).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const selected = await current.evaluate(
      (row) => getComputedStyle(row).backgroundColor,
    );
    expect(selected).not.toBe("rgba(0, 0, 0, 0)");
    await parent.focus();
    await page.keyboard.press("Tab");
    await expect(arrow).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(list).toBeHidden();
    await expect(current).toHaveCount(1);
    await expect(parent).toHaveCSS("background-color", selected);
    await expect(page).toHaveURL(/#bot\/1\/1$/);
    await page.keyboard.press("ArrowRight");
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
