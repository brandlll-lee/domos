import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { expect } from "@playwright/test";
import type { AppRouter } from "../../api/src/router.ts";
import { chooseAppearance, openDetails } from "./fixtures/chat-ui.ts";
import { test } from "./fixtures/service.ts";

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
  await page
    .getByRole("button", { name: "为Domos新建会话", exact: true })
    .click();
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
  await page
    .getByRole("button", { name: "为Domos新建会话", exact: true })
    .click();
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
  await page
    .getByRole("button", { name: "为Domos新建会话", exact: true })
    .click();
  await expect(input).toHaveText("");
  await input.fill("准备面试");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".conversation-children")).toContainText("排队中");
  await page.getByRole("button", { name: "停止生成", exact: true }).click();
  await expect(page.locator(".conversation-children")).toContainText("工作中");
  await service.control("release");
  await expect(page.locator(".conversation-children")).toContainText("未读");
  await page.locator('.conversation-children a[href="#bot/1/1"]').click();
  await expect(page.getByLabel("Domos 的回复")).toContainText("做网站");
});
