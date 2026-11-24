import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { expect } from "@playwright/test";
import type { client as appClient } from "../src/client.ts";
import {
  attachFiles,
  chooseAppearance,
  chooseDetail,
  createBot,
  expectModel,
  openDetails,
} from "./fixtures/chat-ui.ts";
import { test } from "./fixtures/service.ts";

test("memory browsing retains anchors and conflicting edits retain the draft", async ({
  page,
  service,
}, testInfo) => {
  const api = createORPCClient<typeof appClient>(
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  const bot = (await api.bots.list())[0];
  if (!bot) throw new Error("Bot missing");
  const text = "任务记录：保留原始文件与执行证据。".repeat(16);
  for (let index = 0; index < 12; index++) {
    await api.work.memory.save({
      botId: bot.id,
      id: `note-${index}`,
      revision: 0,
      text: `项目笔记 ${index}。${text}`,
      category: "work",
      shared: index === 0,
      requestId: crypto.randomUUID(),
    });
  }
  await page.goto(service.url);
  await openDetails(page);
  const details = page.getByRole("complementary", { name: /的详情$/ });
  await chooseDetail(details, "记忆");
  const memory = page.locator(".memory-dialog");
  const search = memory.getByRole("searchbox", { name: "搜索记忆" });
  await expect(search).toBeFocused();
  await search.fill("项目 笔记");
  await expect(memory.locator(".memory-list li")).toHaveCount(12);
  const row = memory.locator("#memory-note-7");
  await row.scrollIntoViewIfNeeded();
  const viewport = memory.locator(".dialog-body > .scroll-viewport");
  const top = await viewport.evaluate((node) => node.scrollTop);
  expect(top).toBeGreaterThan(0);
  await row.click();
  await expect(memory.getByRole("article", { name: "记忆正文" })).toHaveText(
    new RegExp(text),
  );
  await expect(memory.getByRole("textbox", { name: "内容" })).toHaveCount(0);
  await memory.getByRole("button", { name: "返回", exact: true }).click();
  await expect(search).toHaveValue("项目 笔记");
  await expect(row).toBeFocused();
  expect(await viewport.evaluate((node) => node.scrollTop)).toBeCloseTo(top, 0);
  await row.click();
  await memory.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = memory.getByRole("textbox", { name: "内容" });
  await editor.fill("必须保留的手写草稿");
  await api.work.memory.save({
    botId: bot.id,
    id: "note-7",
    revision: 1,
    text: "另一处已更新这条记忆",
    category: "work",
    shared: false,
    requestId: crypto.randomUUID(),
  });
  await memory.getByRole("button", { name: "保存", exact: true }).click();
  await expect(memory.getByRole("alert")).toBeVisible();
  await expect(editor).toHaveValue("必须保留的手写草稿");
  for (const colorScheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      colorScheme,
    );
    for (const width of [1360, 720]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({
        path: testInfo.outputPath(`editor-${colorScheme}-${width}.png`),
        animations: "disabled",
      });
      expect(
        await editor.evaluate((node) => node.getBoundingClientRect().height),
      ).toBeGreaterThan(300);
      expect(
        await memory.evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
    }
  }
  await memory.getByRole("button", { name: "取消", exact: true }).click();
  await expect(memory.getByRole("article", { name: "记忆正文" })).toContainText(
    "另一处已更新",
  );
  await memory.getByRole("button", { name: "返回", exact: true }).click();
  await search.fill("");
  const info = memory.getByRole("button", { name: "记忆信息", exact: true });
  await expect(info.locator("svg")).toHaveCSS(
    "fill",
    await info.evaluate((node) => getComputedStyle(node).color),
  );
  await info.click();
  await expect(page.getByText("记忆容量", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await memory.getByRole("button", { name: "记忆设置", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "关闭后台回顾", exact: true })
    .click();
  await memory.getByRole("button", { name: "记忆设置", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "开启后台回顾", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: testInfo.outputPath("memory-list-light-narrow.png"),
  });
});

test("automatic memory retains provenance and deletion across a service crash", async ({
  page,
  service,
}) => {
  await page.goto(service.url);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await openDetails(page);
  await service.control("memory-upkeep");
  const details = page.getByRole("complementary", { name: /的详情$/ });
  await chooseDetail(details, "记忆");
  const memory = page.locator(".memory-dialog");
  await expect(memory.locator(".memory-list li")).toHaveCount(2);
  await page.screenshot({ path: "test-results/memory-evidence-dark.png" });
  await memory
    .getByRole("button", { name: "报告使用公制单位", exact: true })
    .click();
  await memory
    .getByRole("button", { name: "查看出处", exact: true })
    .first()
    .click();
  await expect(memory).toBeHidden();
  await expect(page.getByLabel("你的消息")).toContainText(
    "报告使用公制单位，金额使用人民币。",
  );
  await chooseDetail(details, "记忆");
  await memory
    .getByRole("button", { name: "报告使用公制单位", exact: true })
    .click();
  await memory
    .getByRole("button", { name: "记忆操作", exact: true })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "删除", exact: true }).click();
  await page
    .getByRole("dialog", { name: "删除这条记忆？", exact: true })
    .getByRole("button", { name: "删除", exact: true })
    .click();
  await expect(memory.locator(".memory-list li")).toHaveCount(1);
  const port = Number(new URL(service.url).port);
  await service.stop();
  await service.start(port);
  await page.reload();
  await openDetails(page);
  await chooseDetail(details, "记忆");
  await expect(memory.locator(".memory-list li")).toHaveCount(1);
  await expect(memory.locator(".memory-list")).toContainText("金额使用人民币");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.setViewportSize({ width: 720, height: 850 });
  await page.screenshot({ path: "test-results/memory-evidence-narrow.png" });
  expect(
    await memory.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
});

test("profile reads reject late responses and drafts stay with their Bot", async ({
  page,
  service,
}) => {
  const api = createORPCClient<typeof appClient>(
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  const first = (await api.bots.list())[0];
  if (!first) throw new Error("Bot missing");
  const second = await api.bots.create({
    name: "Second",
    requestId: crypto.randomUUID(),
  });
  const captured = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let delay = true;
  await page.route("**/rpc/work/profile", async (route) => {
    const response = await route.fetch();
    if (delay) {
      delay = false;
      captured.resolve();
      await release.promise;
    }
    await route.fulfill({ response });
  });
  await page.goto(service.url);
  await page.getByRole("link", { name: "Domos", exact: false }).click();
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const details = page.locator("#bot-details");
  await details.getByRole("button", { name: "编辑", exact: true }).click();
  await captured.promise;
  const initial = await api.work.profile({ botId: first.id });
  await api.work.update({
    botId: first.id,
    name: "Current",
    instructions: "Current instructions",
    avatar: initial.avatar,
    revision: initial.revision,
    requestId: crypto.randomUUID(),
  });
  const name = details.getByRole("textbox", { name: "名字", exact: true });
  await expect(name).toHaveValue("Current");
  release.resolve();
  await expect(
    details.getByRole("textbox", { name: "职责与长期指令", exact: true }),
  ).toHaveValue("Current instructions");
  await name.fill("First draft");
  await page.getByRole("link", { name: "Second", exact: false }).click();
  if (
    await details.getByRole("button", { name: "编辑", exact: true }).isVisible()
  )
    await details.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(name).toHaveValue("Second");
  await name.fill("Second draft");
  await page.getByRole("link", { name: "Current", exact: false }).click();
  if (
    await details.getByRole("button", { name: "编辑", exact: true }).isVisible()
  )
    await details.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(name).toHaveValue("First draft");
  expect((await api.work.profile({ botId: second.id })).name).toBe("Second");
  await page.evaluate(() => window.dispatchEvent(new Event("domos:computer")));
  await page.getByRole("link", { name: "Second", exact: false }).click();
  if (
    await details.getByRole("button", { name: "编辑", exact: true }).isVisible()
  )
    await details.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(name).toHaveValue("Second");
  await page.getByRole("link", { name: "Current", exact: false }).click();
  if (
    await details.getByRole("button", { name: "编辑", exact: true }).isVisible()
  )
    await details.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(name).toHaveValue("Current");
});

test("chat suggestions fill the draft and dismissal stays complete on other devices and after restart", async ({
  service,
  page,
  browser,
}, testInfo) => {
  await page.goto(service.url);
  const welcome = page.getByRole("region", { name: "入门提示", exact: true });
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(welcome).toBeVisible();
  let sends = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/rpc/send")) sends++;
  });
  await welcome
    .getByRole("button", { name: "帮我完成一项任务", exact: true })
    .click();
  await expect(input).toHaveText("帮我完成一项任务。先问我目标和要求。");
  await expect(input).toBeFocused();
  await expect(page.getByLabel("你的消息", { exact: true })).toHaveCount(0);
  expect(sends).toBe(0);
  await input.fill("我已有的草稿");
  await welcome.getByRole("button", { name: "分析文件", exact: true }).click();
  await expect(input).toHaveText(
    "我已有的草稿\n\n帮我分析一份资料。先问我资料内容和我关心的问题。",
  );
  await page
    .locator("#bot-details")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [1360, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(welcome).toBeInViewport({ ratio: 1 });
      await page.screenshot({
        path: testInfo.outputPath(`welcome-${colorScheme}-${width}.png`),
        animations: "disabled",
      });
    }
  }
  const remote = await browser.newContext();
  try {
    const second = await remote.newPage();
    await second.goto(service.url);
    await expect(
      second.getByRole("region", { name: "入门提示", exact: true }),
    ).toBeVisible();
    await page.route("**/rpc/bots/completeWelcome", (route) => route.abort());
    await welcome.getByRole("button", { name: "关闭入门提示" }).click();
    await expect(welcome.getByRole("alert")).toContainText("请重试");
    await expect(input).toHaveText(/我已有的草稿/);
    await page.unroute("**/rpc/bots/completeWelcome");
    await welcome.getByRole("button", { name: "关闭入门提示" }).click();
    await expect(welcome).toBeHidden();
    await expect(input).toBeFocused();
    await expect(
      second.getByRole("region", { name: "入门提示", exact: true }),
    ).toBeHidden();
    const port = Number(new URL(service.url).port);
    await service.stop();
    await service.start(port);
    await page.reload();
    await expect(input).toBeVisible();
    await expect(welcome).toBeHidden();
    await expect(input).toHaveText(/我已有的草稿/);
  } finally {
    await remote.close();
  }
});

test("Bot details manage identity, memory, shared skills, routines and actual prompts", async ({
  service,
  page,
}) => {
  await page.goto(service.url);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const dialog = page.getByRole("complementary", { name: /的详情$/ });
  const sections = dialog;
  await chooseDetail(sections, "身份");
  await expect(dialog.getByLabel("名字", { exact: true })).toBeEnabled();
  await dialog.getByLabel("名字", { exact: true }).fill("档案员");
  await dialog.getByLabel("职责与长期指令").fill("整理资料，用简洁中文回复。");
  await dialog.getByRole("button", { name: "保存身份", exact: true }).click();
  await expect(dialog).toHaveAccessibleName("档案员的详情");
  await chooseDetail(sections, "记忆");
  const memoryDialog = page.locator(".dialog-popup").first();
  await memoryDialog
    .getByRole("button", { name: "新增记忆", exact: true })
    .click();
  await memoryDialog
    .getByRole("textbox", { name: "内容", exact: true })
    .fill("报告使用公制单位。");
  await memoryDialog.getByLabel("共享给所有 Bot").check();
  await memoryDialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(memoryDialog.locator(".memory-list")).toContainText(
    "报告使用公制单位。",
  );
  await memoryDialog
    .getByRole("button", { name: "关闭弹窗", exact: true })
    .click();
  await chooseDetail(sections, "技能");
  await dialog.getByLabel("导入技能包").setInputFiles({
    name: "SKILL.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "---\nname: report\ndescription: 整理资料并生成报告\n---\n\n使用保存的偏好。检查文件后交付。\n",
    ),
  });
  await expect(dialog.getByLabel("新建 SKILL.md")).toHaveValue(/name: report/);
  await dialog.getByRole("button", { name: "保存技能", exact: true }).click();
  await expect(dialog.getByRole("region", { name: "技能差异" })).toBeVisible();
  await dialog.getByRole("button", { name: "保存技能", exact: true }).click();
  const skill = dialog.locator(".item-list li").filter({ hasText: "report" });
  await expect(skill).toContainText("此 Bot 未启用");
  const skillSwitch = skill.getByRole("switch", {
    name: "为此 Bot 启用 report",
    exact: true,
  });
  await skillSwitch.click();
  await expect(skillSwitch).toBeChecked();
  await expect(skill).toContainText("此 Bot 已启用");
  await skill
    .getByRole("button", { name: "report的操作", exact: true })
    .click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "导出", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("report.zip");
  await chooseDetail(sections, "定时");
  await dialog
    .getByRole("button", { name: "新建定时任务", exact: true })
    .click();
  await dialog.getByLabel("任务名称").fill("早间报告");
  await dialog.getByLabel("工作要求").fill("整理报告，发回当前聊天。");
  await dialog.getByLabel("report", { exact: true }).check();
  await dialog.getByRole("combobox", { name: "重复频率", exact: true }).click();
  await page.getByRole("option", { name: "每周", exact: true }).click();
  await dialog.getByRole("combobox", { name: "星期", exact: true }).click();
  await page.getByRole("option", { name: "周三", exact: true }).click();
  await dialog.getByLabel("每天执行时间", { exact: true }).fill("08:30");
  await dialog.getByRole("button", { name: "保存为暂停", exact: true }).click();
  const routine = dialog
    .locator(".item-list li")
    .filter({ hasText: "早间报告" });
  await expect(routine).toContainText("已暂停");
  await expect(routine).toContainText("每周三 08:30");
  const enabled = routine.getByRole("switch", {
    name: "启用 早间报告",
    exact: true,
  });
  const actions = routine.locator(".item-actions");
  const centers = await actions
    .locator('[role="switch"], [aria-haspopup="menu"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return box.y + box.height / 2;
      }),
    );
  expect(centers).toHaveLength(2);
  expect(centers[0]).toBe(centers[1]);
  await enabled.click();
  await expect(enabled).toBeChecked();
  await expect(routine).toContainText("已启用");
  await enabled.click();
  await expect(enabled).not.toBeChecked();
  await expect(routine).toContainText("已暂停");
  await service.control({ content: "报告已交付。" });
  await routine
    .getByRole("button", { name: "早间报告的操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "试跑", exact: true }).click();
  await dialog
    .locator("summary")
    .filter({ hasText: /^运行记录/ })
    .click();
  await expect(dialog).toContainText("已完成");
  await chooseDetail(sections, "提示词");
  await dialog
    .getByRole("button", { name: "读取实际提示词", exact: true })
    .click();
  await expect(dialog.getByText("identity", { exact: true })).toBeVisible();
  await dialog.getByText("identity", { exact: true }).click();
  await expect(
    dialog
      .locator("details")
      .filter({ has: page.locator("summary", { hasText: /^identity$/ }) })
      .locator("pre"),
  ).toContainText("档案员");
  await page.screenshot({ path: "test-results/bot-work-desktop.png" });
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByLabel("档案员 的回复")).toContainText("报告已交付。");
  await expect(page.getByLabel("你的消息")).toHaveCount(0);
  await expect(page.locator(".routine-source")).toContainText("早间报告");
  const port = Number(new URL(service.url).port);
  await service.stop();
  await service.start(port);
  await page.reload();
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await chooseDetail(sections, "记忆");
  await expect(memoryDialog.locator(".memory-list")).toContainText(
    "报告使用公制单位。",
  );
  await memoryDialog
    .getByRole("button", { name: "关闭弹窗", exact: true })
    .click();
  await chooseDetail(sections, "定时");
  await dialog
    .locator("summary")
    .filter({ hasText: /^运行记录/ })
    .click();
  await expect(dialog).toContainText("已完成");
  await chooseDetail(sections, "记忆");
  const memory = memoryDialog
    .locator(".memory-list li")
    .filter({ hasText: "报告使用公制单位。" });
  await memory.getByRole("button").click();
  const remove = memoryDialog.getByRole("button", {
    name: "记忆操作",
    exact: true,
  });
  await remove.click();
  await page.getByRole("menuitem", { name: "删除", exact: true }).click();
  const confirmation = page.getByRole("dialog", {
    name: "删除这条记忆？",
    exact: true,
  });
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await expect(remove).toBeFocused();
  await remove.click();
  await page.getByRole("menuitem", { name: "删除", exact: true }).click();
  await confirmation.getByRole("button", { name: "删除", exact: true }).click();
  await expect(memory).toHaveCount(0);
});

test("Bot details retain invalid skill edits and fit a narrow viewport", async ({
  service,
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(service.url);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const dialog = page.getByRole("complementary", { name: /的详情$/ });
  const sections = dialog;
  await chooseDetail(sections, "技能");
  await dialog.getByRole("button", { name: "新建技能", exact: true }).click();
  await dialog.getByLabel("新建 SKILL.md").fill("invalid skill");
  await dialog.getByRole("button", { name: "保存技能", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("YAML");
  await expect(dialog.getByLabel("新建 SKILL.md")).toHaveValue("invalid skill");
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/bot-work-mobile.png" });
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Bot详情", exact: true }),
  ).toBeFocused();
  await chooseAppearance(page, "深色");
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await chooseDetail(sections, "身份");
  await expect(dialog.getByLabel("名字", { exact: true })).toBeEnabled();
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/bot-work-mobile-dark.png" });
});

test("Bot details share the desktop with chat and cover narrow screens", async ({
  service,
  page,
}) => {
  await page.goto(service.url);
  const trigger = page.getByRole("button", { name: "Bot详情", exact: true });
  const panel = page.getByRole("complementary", { name: /的详情$/ });
  await trigger.click();
  await chooseDetail(panel, "身份");
  await expect(panel.getByLabel("名字", { exact: true })).toBeEnabled();
  await expect(
    page.getByRole("dialog", { name: "Bot详情", exact: true }),
  ).not.toHaveAttribute("aria-modal", "true");
  const chat = page.locator(".conversation");
  await expect(async () => {
    const chatBox = await chat.boundingBox();
    const panelBox = await page
      .locator('.workspace-panel[data-side="inspector"]')
      .boundingBox();
    if (!chatBox || !panelBox) throw new Error("Chat details layout missing");
    expect(panelBox.x - chatBox.x - chatBox.width).toBe(0);
    expect(panelBox.x + panelBox.width).toBeCloseTo(1360 - chatBox.y, 0);
  }).toPass();
  const input = page.getByLabel("消息", { exact: true });
  await input.fill("面板打开时继续聊天");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByLabel("Domos 的回复")).toContainText("完整回复。");
  await page.screenshot({
    path: "test-results/bot-details-side-light.png",
    animations: "disabled",
  });
  await chooseAppearance(page, "深色");
  await page.screenshot({
    path: "test-results/bot-details-side-dark.png",
    animations: "disabled",
  });
  await openDetails(page);
  await chooseDetail(panel, "提示词");
  await panel.getByRole("button", { name: "读取实际提示词" }).click();
  await page.setViewportSize({ width: 1360, height: 500 });
  await panel.getByText("完整提示词", { exact: true }).click();
  await expect
    .poll(() =>
      panel
        .locator(".detail-content")
        .evaluate((element) => element.scrollHeight > element.clientHeight),
    )
    .toBe(true);
  await panel.locator(".detail-content").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() =>
      panel.locator(".detail-content").evaluate((element) => element.scrollTop),
    )
    .toBeGreaterThan(0);
  await expect(input).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("dialog", { name: "Bot详情", exact: true }),
  ).toHaveAttribute("aria-modal", "true");
  await chooseDetail(panel, "身份");
  await expect(panel.getByLabel("名字", { exact: true })).toBeVisible();
  const mobileBox = await panel.boundingBox();
  expect(mobileBox?.x).toBe(0);
  expect(mobileBox?.width).toBe(390);
  expect(
    await page.locator("body").evaluate((element) => element.scrollWidth),
  ).toBe(390);
  await page.screenshot({ path: "test-results/bot-details-side-mobile.png" });
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(chat).toBeVisible();
});

test("workspace separates Bot controls and global settings", async ({
  service,
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(service.url);
  const trigger = page.getByRole("button", { name: "Bot详情", exact: true });
  for (const width of [360, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const header = await trigger.boundingBox();
    expect(header?.y).toBeGreaterThanOrEqual(0);
    await expect(page.locator("#settings-trigger")).toHaveCount(1);
    await trigger.click();
    const details = page.getByRole("complementary", { name: /的详情$/ });
    await chooseDetail(details, "运行");
    await expect(
      details.getByRole("combobox", { name: "模型", exact: true }),
    ).toBeEnabled();
    await expect(
      details.getByRole("combobox", { name: "外观", exact: true }),
    ).toHaveCount(0);
    await details.focus();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    expect(await page.locator("body").evaluate((el) => el.scrollWidth)).toBe(
      width,
    );
  }
  expect(errors).toEqual([]);
});

test("contacts keep independent histories, drafts, models, and locations after restart", async ({
  service,
  page,
  browser,
}) => {
  await page.goto(service.url);
  const input = page.getByLabel("消息", { exact: true });
  const send = page.getByRole("button", { name: "发送", exact: true });
  await expect(input).toBeEnabled();
  await input.fill("原来的对话");
  await send.click();
  await expect(page.getByLabel("Domos 的回复")).toContainText("完整回复。");
  await expect(
    page.getByRole("button", { name: "语音输入（暂未开放）", exact: true }),
  ).toBeVisible();
  await input.fill("原来的草稿");
  const other = await browser.newPage();
  await other.goto(service.url);
  await createBot(page, "研究员", "测试模型二");
  const researchUrl = page.url();
  const contacts = page.getByRole("navigation", {
    name: "联系人",
    exact: true,
  });
  await expect(
    other
      .getByRole("navigation", { name: "联系人", exact: true })
      .getByRole("link", { name: "研究员" }),
  ).toBeVisible();
  await other.close();
  await input.fill("研究问题");
  await send.click();
  await expect(page.getByLabel("研究员 的回复")).toContainText("faux-2");
  await expect(
    page.getByRole("button", { name: "语音输入（暂未开放）", exact: true }),
  ).toBeVisible();
  await input.fill("研究草稿");
  await contacts.getByRole("link", { name: /^Domos/ }).click();
  await expect(input).toHaveText("原来的草稿");
  await expectModel(page, "测试模型一");
  await createBot(page, "写作助手");
  await input.fill("写作问题");
  await send.click();
  await expect(page.getByLabel("写作助手 的回复")).toContainText("faux-1");
  await expect(
    page.getByRole("button", { name: "语音输入（暂未开放）", exact: true }),
  ).toBeVisible();
  await input.fill("写作草稿");
  await contacts.getByRole("link", { name: "研究员", exact: true }).click();
  await expect(input).toHaveText("研究草稿");
  await expect(page.getByLabel("你的消息")).toContainText("研究问题");
  await expectModel(page, "测试模型二");
  await page.reload();
  await expect(input).toHaveText("研究草稿");
  await other.close();
  const port = Number(new URL(service.url).port);
  await service.stop();
  await service.start(port);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  expect(page.url()).toBe(researchUrl);
  await expect(contacts.locator(".contact-row")).toHaveCount(3);
  await expect(page.getByLabel("研究员 的回复")).toContainText("faux-2");
  await contacts.getByRole("link", { name: "写作助手", exact: true }).click();
  await expect(input).toHaveText("写作草稿");
  await expect(page.getByLabel("你的消息")).toContainText("写作问题");
  await page.screenshot({ path: "test-results/bot-contacts.png" });
});

test("switching contacts keeps the first Bot running while another Bot replies", async ({
  service,
  page,
}) => {
  await page.goto(service.url);
  await createBot(page, "助手");
  const contacts = page.getByRole("navigation", {
    name: "联系人",
    exact: true,
  });
  await contacts.getByRole("link", { name: /^Domos/ }).click();
  const input = page.getByLabel("消息", { exact: true });
  const send = page.getByRole("button", { name: "发送", exact: true });
  await expect(input).toHaveAttribute("data-placeholder", "发送消息给 Domos…");
  await service.control("gate");
  await input.fill("后台任务");
  await send.click();
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  await contacts.getByRole("link", { name: "助手", exact: true }).click();
  await expect(input).toHaveAttribute("data-placeholder", "发送消息给 助手…");
  await input.fill("另一个任务");
  await send.click();
  await expect(page.getByLabel("助手 的回复")).toContainText("完整回复。");
  await expect(
    page.getByRole("button", { name: "语音输入（暂未开放）", exact: true }),
  ).toBeVisible();
  await contacts.getByRole("link", { name: /^Domos/ }).click();
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  await service.control("release");
  await expect(page.getByLabel("Domos 的回复")).toContainText("后台任务");
  await expect(
    page.getByRole("button", { name: "语音输入（暂未开放）", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("你的消息")).toContainText("后台任务");
});

test("creation retries keep one contact and themed dialogs work on narrow screens", async ({
  service,
  page,
}) => {
  await page.goto(service.url);
  const trigger = page.getByRole("button", { name: "新建", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "新建 Bot", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建 Bot", exact: true });
  const name = dialog.getByLabel("名字", { exact: true });
  await expect(name).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  for (const theme of ["浅色", "深色"]) {
    await chooseAppearance(page, theme);
    await trigger.click();
    await page.getByRole("menuitem", { name: "新建 Bot", exact: true }).click();
    await name.fill("设计助手");
    await expect(
      dialog.getByRole("textbox", { name: "名字", exact: true }),
    ).toBeEnabled();
    await expect(
      dialog.getByRole("textbox", { name: "HEX", exact: true }),
    ).toBeVisible();
    await expect(dialog.getByRole("combobox")).toHaveCount(0);
    await page.screenshot({ path: `test-results/bot-dialog-${theme}.png` });
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".workspace")).toHaveAttribute(
    "data-mobile",
    "true",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "联系人", exact: true }).click();
  let first = true;
  await page.route("**/rpc/bots/create", async (route) => {
    if (first) {
      first = false;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await trigger.click();
  await page.getByRole("menuitem", { name: "新建 Bot", exact: true }).click();
  await name.fill("设计助手");
  const create = dialog.getByRole("button", { name: "创建", exact: true });
  await expect(create).toBeEnabled();
  await page.screenshot({ path: "test-results/bot-dialog-mobile.png" });
  const frame = await dialog.boundingBox();
  await expect(
    dialog
      .locator(".dialog-footer")
      .getByRole("button", { name: "创建", exact: true }),
  ).toBeInViewport();
  await create.click();
  expect(await dialog.boundingBox()).toEqual(frame);
  await expect(dialog.getByRole("alert")).toContainText("创建未确认");
  await create.click();
  expect(await dialog.boundingBox()).toEqual(frame);
  await dialog.getByRole("button", { name: "Pi", exact: true }).click();
  await dialog.getByRole("combobox", { name: "模型", exact: true }).click();
  await page
    .getByRole("option", { name: "Pi · 测试模型一", exact: true })
    .click();
  await expect(
    dialog
      .locator(".dialog-footer")
      .getByRole("button", { name: "开始聊天", exact: true }),
  ).toBeInViewport();
  await dialog.getByRole("button", { name: "开始聊天", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "联系人", exact: true }).click();
  const contacts = page.getByRole("navigation", {
    name: "联系人",
    exact: true,
  });
  await expect(contacts.locator(".contact-row")).toHaveCount(2);
  await expect(
    contacts.getByRole("link", { name: "设计助手", exact: true }),
  ).toBeVisible();
  await expect(
    contacts
      .getByRole("navigation", { name: "设计助手的会话列表" })
      .locator('[aria-current="page"]'),
  ).toHaveCount(1);
  await contacts.getByRole("link", { name: "Domos", exact: true }).click();
  await expect(page.getByLabel("消息", { exact: true })).toHaveAttribute(
    "data-placeholder",
    "发送消息给 Domos…",
  );
  await page.screenshot({ path: "test-results/bot-contacts-mobile.png" });
});

test("working contacts retain animated status across switches, concurrent work, reload, and stop", async ({
  service,
  page,
}) => {
  await page.goto(service.url);
  const input = page.getByLabel("消息", { exact: true });
  await expect(input).toBeEnabled();
  await service.control("gate");
  await input.fill("后台任务");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const first = page.locator('.sidebar a[href="#bot/1"]');
  await expect(first.getByRole("status", { name: "正在工作" })).toBeVisible();
  await createBot(page, "第二位助手");
  const second = page
    .getByRole("navigation", { name: "联系人", exact: true })
    .getByRole("link", { name: "第二位助手" });
  await expect(first.locator(".bot-avatar > .loading-dots")).toBeVisible();
  await expect(second.locator(".bot-avatar > .loading-dots")).toHaveCount(0);
  await service.control("gate");
  await input.fill("另一个任务");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.locator(".sidebar .bot-avatar > .loading-dots"),
  ).toHaveCount(2);
  await page.reload();
  await expect(
    page.locator(".sidebar .bot-avatar > .loading-dots"),
  ).toHaveCount(2);
  for (const [theme, label] of [
    ["light", "浅色"],
    ["dark", "深色"],
  ] as const) {
    await chooseAppearance(page, label);
    const dot = first.locator(".bot-avatar > .loading-dots");
    const points = dot.locator("g");
    await expect(points).toHaveCount(3);
    for (const [index, color] of [
      "rgb(255, 190, 50)",
      "rgb(37, 216, 132)",
      "rgb(255, 82, 101)",
    ].entries()) {
      await expect(points.nth(index)).toHaveCSS("color", color);
      await expect(points.nth(index)).toHaveCSS(
        "animation-name",
        "loading-wave",
      );
    }
    const offset = await dot.evaluate((element) => {
      const frame = element.closest(".bot-avatar")?.getBoundingClientRect();
      if (!frame) throw new Error("Working avatar missing");
      const bounds = element.getBoundingClientRect();
      return {
        right: bounds.right - frame.right,
        bottom: bounds.bottom - frame.bottom,
      };
    });
    expect(offset.right).toBeCloseTo(4, 0);
    expect(offset.bottom).toBeCloseTo(2, 0);
    await page.screenshot({
      path: `test-results/contacts-${theme}-working.png`,
      animations: "disabled",
    });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(first.locator(".loading-dots g").first()).toHaveCSS(
    "animation-name",
    "none",
  );
  await service.control("release");
  await expect(second.locator(".bot-avatar > .loading-dots")).toHaveCount(0);
  await expect(first.locator(".bot-avatar > .loading-dots")).toBeVisible();
  await first.click();
  await page.getByRole("button", { name: "停止生成", exact: true }).click();
  await expect(
    page.locator(".sidebar .bot-avatar > .loading-dots"),
  ).toHaveCount(0);
});

test("Bot identity stays consistent and image previews work in drafts and history", async ({
  service,
  page,
}) => {
  await page.goto(service.url);
  await chooseAppearance(page, "浅色");
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page.getByRole("menuitem", { name: "新建 Bot", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建 Bot", exact: true });
  const avatar = dialog.locator(".avatar-editor .avatar-preview > .bot-avatar");
  const initial = await avatar.getAttribute("data-seed");
  for (const name of ["兔子", "幽灵", "火箭", "手柄", "幼苗", "气泡"]) {
    const shape = page.getByRole("button", {
      name: `外形：${name}`,
      exact: true,
    });
    await shape.click();
    await expect(shape).toHaveAttribute("aria-pressed", "true");
    await expect(avatar.locator(".character")).toHaveCSS("opacity", "1");
  }
  await expect(avatar).not.toHaveAttribute("data-seed", initial ?? "");
  const seed = await avatar.getAttribute("data-seed");
  expect(seed).toBeTruthy();
  await dialog.getByLabel("名字", { exact: true }).fill("视觉助手");
  await dialog.getByRole("button", { name: "创建", exact: true }).click();
  await dialog.getByRole("button", { name: "Pi", exact: true }).click();
  await dialog.getByRole("combobox", { name: "模型", exact: true }).click();
  await page
    .getByRole("option", { name: "Pi · 测试模型一", exact: true })
    .click();
  await dialog.getByRole("button", { name: "开始聊天", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const selected = page
    .getByRole("link", { name: "视觉助手", exact: true })
    .locator(".bot-avatar");
  await expect(selected).toHaveAttribute("data-seed", seed ?? "");
  await expect(page.locator(".chat-identity .bot-avatar")).toHaveAttribute(
    "data-seed",
    seed ?? "",
  );
  await expect(page.locator(".transcript .bot-avatar")).toHaveCount(0);
  await expect(page.locator(".conversation-time")).toBeVisible();
  await expect(selected.locator(".character-pupils")).toHaveCount(2);
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=",
    "base64",
  );
  await attachFiles(page, {
    name: "sample.png",
    mimeType: "image/png",
    buffer: bytes,
  });
  const draft = page.locator(".composer-attachments img");
  await expect(draft).toBeVisible();
  await expect(draft).toHaveJSProperty("naturalWidth", 1);
  await page.reload();
  await expect(selected).toHaveAttribute("data-seed", seed ?? "");
  await expect(draft).toBeVisible();
  await page.getByLabel("消息", { exact: true }).fill("查看图片");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const history = page
    .getByLabel("你的消息", { exact: true })
    .getByRole("img", { name: "sample.png" });
  await expect(history).toHaveJSProperty("naturalWidth", 1);
  await expect(page.getByLabel("视觉助手 的回复")).toHaveCount(1, {
    timeout: 30000,
  });
  await page.reload();
  await expect(history).toHaveJSProperty("naturalWidth", 1);
  await expect(selected).toHaveAttribute("data-seed", seed ?? "");
  await page.screenshot({
    path: "test-results/characters-light.png",
    fullPage: true,
  });
  await chooseAppearance(page, "深色");
  await page.screenshot({
    path: "test-results/characters-dark.png",
    fullPage: true,
  });
});

test("detail pages load their own data and isolate profile errors", async ({
  service,
  page,
}) => {
  let streams = 0;
  let profiles = 0;
  await page.route("**/rpc/work/subscribe", async (route) => {
    streams++;
    await route.abort();
  });
  await page.route("**/rpc/work/profile", async (route) => {
    profiles++;
    await route.continue();
  });
  await page.goto(service.url);
  const details = page.locator("#bot-details");
  await details.getByRole("tab", { name: "Computer", exact: true }).click();
  await page.getByRole("button", { name: "电脑设置", exact: true }).click();
  await expect(
    details.getByRole("region", { name: "工作目录与权限", exact: true }),
  ).toBeVisible();
  await expect(details.getByRole("status")).toHaveCount(0);
  expect(streams).toBe(0);
  expect(profiles).toBe(0);
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await details.getByRole("tab", { name: "Bot", exact: true }).click();
  await details.getByRole("button", { name: "编辑", exact: true }).click();
  const name = details.getByRole("textbox", { name: "名字", exact: true });
  await expect(name).toHaveValue("Domos");
  await name.fill("保留资料草稿");
  expect(profiles).toBe(1);
  await expect(details.getByRole("status")).toHaveCount(0);
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await details.getByRole("button", { name: /^技能/ }).click();
  await expect(page.locator(".attention-toast[data-error]")).toContainText(
    "详情连接中断",
  );
  await expect(details.getByRole("alert")).toHaveCount(0);
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await details.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(name).toHaveValue("保留资料草稿");
  await expect(details.getByRole("alert")).toHaveCount(0);
});

test("profile loading recovers without retaining an old error", async ({
  service,
  page,
}) => {
  let fail = true;
  await page.route("**/rpc/work/profile", async (route) => {
    if (fail) await route.fulfill({ status: 503, body: "Unavailable" });
    else await route.continue();
  });
  await page.goto(service.url);
  const details = page.locator("#bot-details");
  await details.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.locator(".attention-toast[data-error]")).toBeVisible();
  await expect(details.getByRole("status")).toHaveCount(0);
  fail = false;
  await page
    .locator(".attention-toast[data-error]")
    .getByRole("button", { name: "重试", exact: true })
    .click();
  await expect(
    details.getByRole("textbox", { name: "名字", exact: true }),
  ).toHaveValue("Domos");
  await expect(details.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".attention-toast[data-error]")).toHaveCount(0);
});

test("Bot panels keep their hierarchy in both themes and panel widths", async ({
  service,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(service.url);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const details = page.getByRole("complementary", {
    name: "Domos的详情",
    exact: true,
  });
  const handle = page.getByRole("separator", { name: "调整详情宽度" });
  await expect(
    page.locator('.workspace-panel[data-side="inspector"]'),
  ).toHaveCSS("translate", "none");
  for (const width of [320, 384, 640]) {
    await page.evaluate(() => document.activeViewTransition?.finished);
    await handle.hover();
    const current = Number(await handle.getAttribute("aria-valuenow"));
    const box = await handle.boundingBox();
    if (!box) throw new Error("Resize handle missing");
    await page.mouse.move(box.x + box.width / 2, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + current - width,
      box.y + 100,
      { steps: 5 },
    );
    await page.mouse.up();
    await expect(handle).toHaveAttribute("aria-valuenow", String(width));
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.evaluate(() => document.fonts.ready);
      await expect(
        details.getByRole("region", { name: "运行", exact: true }),
      ).toBeVisible();
      await expect(
        details.getByRole("region", { name: "能力", exact: true }),
      ).toBeVisible();
      expect(
        await details.evaluate((item) => item.scrollWidth <= item.clientWidth),
      ).toBe(true);
      await details.screenshot({
        path: testInfo.outputPath(`bot-panel-${width}-${theme}.png`),
      });
    }
  }
  await details.getByRole("button", { name: /^记忆(?:\s|$)/ }).click();
  const memoryDialog = page.locator(".memory-dialog");
  await expect(memoryDialog).toBeVisible();
  await expect(page.locator("#bot-details .panel-page")).toBeVisible();
  await memoryDialog.getByRole("button", { name: "新增记忆" }).click();
  const memory = memoryDialog.getByRole("textbox", {
    name: "内容",
    exact: true,
  });
  await memory.fill("会议记录使用简洁中文。");
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await memory.click();
    await expect(memory).toHaveCSS(
      "background-color",
      theme === "dark" ? "rgb(20, 20, 22)" : "rgb(250, 250, 250)",
    );
    await expect(memory).toHaveCSS("resize", "none");
    await expect(memory).toHaveCSS("scrollbar-width", "thin");
    await expect(memoryDialog.locator("form")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await expect(memory).toHaveCSS("outline-style", "none");
    await memory.press("Tab");
    await memoryDialog
      .getByRole("checkbox", { name: "共享给所有 Bot" })
      .focus();
    await expect(
      memoryDialog.getByRole("checkbox", { name: "共享给所有 Bot" }),
    ).toBeFocused();
    const save = memoryDialog.getByRole("button", {
      name: "保存",
      exact: true,
    });
    await expect(save).toBeEnabled();
    await expect(save).toHaveCSS(
      "background-color",
      await page
        .locator("body")
        .evaluate((item) => getComputedStyle(item).color),
    );
    await expect(save).toHaveCSS("border-radius", "8px");
    await memoryDialog.screenshot({
      path: testInfo.outputPath(`memory-editor-${theme}.png`),
    });
  }
  await memoryDialog.getByRole("button", { name: "保存", exact: true }).click();
  const entry = memoryDialog.getByRole("button", {
    name: "会议记录使用简洁中文。",
    exact: true,
  });
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(memoryDialog.locator(".memory-list")).toHaveCount(0);
  await expect(
    memoryDialog.getByRole("article", { name: "记忆正文" }),
  ).toContainText("会议记录使用简洁中文。");
  await memoryDialog.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(
    memoryDialog.getByRole("textbox", { name: "内容", exact: true }),
  ).toHaveValue("会议记录使用简洁中文。");
  await memoryDialog.getByRole("button", { name: "取消", exact: true }).click();
  await memoryDialog.getByRole("button", { name: "返回", exact: true }).click();
  await expect(entry).toBeVisible();
  await memoryDialog.screenshot({
    path: testInfo.outputPath("memory-list.png"),
  });
  await memoryDialog.getByRole("button", { name: "关闭弹窗" }).click();
  await details.getByRole("button", { name: /^记忆(?:\s|$)/ }).click();
  await expect(memoryDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(memoryDialog).toBeHidden();
  await expect(
    details.getByRole("button", { name: /^记忆(?:\s|$)/ }),
  ).toBeFocused();
  await details.getByRole("button", { name: /^技能(?:\s|$)/ }).click();
  await details.screenshot({ path: testInfo.outputPath("skills-list.png") });
  await details.getByRole("button", { name: "新建技能", exact: true }).click();
  await details.screenshot({
    path: testInfo.outputPath("skill-editor-dark.png"),
  });
  await expect(
    details.getByRole("button", { name: "导入", exact: true }),
  ).toHaveCount(0);
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await expect(
    details.getByRole("button", { name: "导入", exact: true }),
  ).toBeVisible();
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await details.getByRole("button", { name: /^定时(?:\s|$)/ }).click();
  await details.screenshot({ path: testInfo.outputPath("routine-list.png") });
  await details
    .getByRole("button", { name: "新建定时任务", exact: true })
    .click();
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(
      details.getByRole("textbox", { name: "工作要求", exact: true }),
    ).toHaveCSS(
      "background-color",
      theme === "dark" ? "rgb(20, 20, 22)" : "rgb(250, 250, 250)",
    );
    await details.screenshot({
      path: testInfo.outputPath(`routine-editor-${theme}.png`),
    });
  }
  await expect(details.getByText("运行记录", { exact: true })).toHaveCount(0);
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await expect(details.getByText("运行记录", { exact: true })).toBeVisible();
});
