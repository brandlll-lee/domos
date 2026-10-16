import { type ChildProcess, fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

let worker: ChildProcess;
let url: string;
let database: string;
let directory: string;
let toolName: string;

async function start(port = 0) {
  worker = fork(
    fileURLToPath(
      new URL("../../api/test/fixtures/web-server.ts", import.meta.url),
    ),
    [database, String(port)],
    { silent: true, execArgv: [] },
  );
  worker.stderr?.resume();
  worker.stdout?.resume();
  const ready = await Promise.race([
    once(worker, "message").then(
      ([message]) =>
        message as { type: string; port: number; toolName: string },
    ),
    once(worker, "exit").then(() => {
      throw new Error("Test server exited");
    }),
  ]);
  url = `http://127.0.0.1:${ready.port}`;
  toolName = ready.toolName;
}

async function stop() {
  const exited = once(worker, "exit");
  worker.kill("SIGKILL");
  await exited;
}

async function control(
  command:
    | string
    | { content: unknown; stopReason?: "stop" | "toolUse" }
    | { responses: { content: unknown; stopReason?: "stop" | "toolUse" }[] },
) {
  const receipt = once(worker, "message");
  worker.send(command);
  await receipt;
}

async function chooseAppearance(
  page: import("@playwright/test").Page,
  label: string,
) {
  const details = page.getByRole("complementary", { name: /的详情$/ });
  const opened = !(await details.isVisible());
  if (opened) await openDetails(page);
  await page.getByRole("combobox", { name: "外观", exact: true }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
  if (opened)
    await details.getByRole("button", { name: "关闭", exact: true }).click();
}

async function openDetails(page: import("@playwright/test").Page) {
  const details = page.getByRole("complementary", { name: /的详情$/ });
  if (!(await details.isVisible()))
    await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  return details;
}

async function expectModel(
  page: import("@playwright/test").Page,
  text: string,
) {
  const details = await openDetails(page);
  await expect(
    details.getByRole("combobox", { name: "模型", exact: true }),
  ).toContainText(text);
  await details.getByRole("button", { name: "关闭", exact: true }).click();
}

async function expectTextContrast(page: import("@playwright/test").Page) {
  const ratios = await page.evaluate(() => {
    const luminance = (color: string) => {
      const channels = (color.match(/[\d.]+/g) ?? [])
        .slice(0, 3)
        .map(Number)
        .map((value) => {
          const s = value / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
      const [red, green, blue] = channels;
      if (red === undefined || green === undefined || blue === undefined)
        throw new Error("Invalid computed color");
      return red * 0.2126 + green * 0.7152 + blue * 0.0722;
    };
    return [
      ...document.querySelectorAll<HTMLElement>(
        ".sidebar-label, .sidebar-footer span, .chat-preview span, .picker-trigger, .message-bubble, .picker-item",
      ),
    ].map((element) => {
      let background: Element | null = element;
      while (
        background &&
        getComputedStyle(background).backgroundColor === "rgba(0, 0, 0, 0)"
      )
        background = background.parentElement;
      const foreground = luminance(getComputedStyle(element).color);
      if (!background) throw new Error("Missing opaque background");
      const surface = luminance(getComputedStyle(background).backgroundColor);
      return (
        (Math.max(foreground, surface) + 0.05) /
        (Math.min(foreground, surface) + 0.05)
      );
    });
  });
  expect(ratios.length).toBeGreaterThan(0);
  for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
}

test.beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "domos-browser-"));
  database = join(directory, "agent.sqlite");
  await start();
});

test.afterEach(async () => {
  if (worker.exitCode === null) await stop();
  await rm(directory, { recursive: true, force: true });
});

async function createBot(
  page: import("@playwright/test").Page,
  name: string,
  model?: string,
) {
  if (
    !(await page
      .getByRole("button", { name: "新建 Bot", exact: true })
      .isVisible())
  )
    await openDetails(page);
  await page.getByRole("button", { name: "新建 Bot", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建 Bot", exact: true });
  await dialog.getByLabel("名字", { exact: true }).fill(name);
  await dialog
    .getByLabel("职责与指令", { exact: true })
    .fill(`负责${name}的工作。`);
  const picker = dialog.getByRole("combobox", {
    name: "默认模型",
    exact: true,
  });
  await expect(picker).toBeEnabled();
  if (model) {
    await picker.click();
    await page
      .getByRole("option", { name: `faux · ${model}`, exact: true })
      .click();
  }
  await dialog.getByRole("button", { name: "创建", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("消息", { exact: true })).toHaveAttribute(
    "placeholder",
    `发送消息给 ${name}…`,
  );
}

test("Bot details manage identity, memory, shared skills, routines and actual prompts", async ({
  page,
}) => {
  await page.goto(url);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const dialog = page.getByRole("complementary", { name: /的详情$/ });
  const sections = dialog.getByRole("navigation", { name: "Bot设置分区" });
  await expect(dialog.getByLabel("名字", { exact: true })).toBeEnabled();
  await dialog.getByLabel("名字", { exact: true }).fill("档案员");
  await dialog.getByLabel("职责与长期指令").fill("整理资料，用简洁中文回复。");
  await dialog.getByRole("button", { name: "保存身份", exact: true }).click();
  await expect(dialog).toHaveAccessibleName("档案员的详情");
  await sections.getByRole("button", { name: "记忆", exact: true }).click();
  await dialog.getByLabel("新增记忆").fill("报告使用公制单位。");
  await dialog.getByLabel("共享给所有Bot").check();
  await dialog.getByRole("button", { name: "保存记忆", exact: true }).click();
  await expect(dialog.locator(".detail-list")).toContainText(
    "报告使用公制单位。",
  );
  await sections.getByRole("button", { name: "技能", exact: true }).click();
  await dialog.getByLabel("导入SKILL.md").setInputFiles({
    name: "SKILL.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "---\nname: report\ndescription: 整理资料并生成报告\n---\n\n使用保存的偏好。检查文件后交付。\n",
    ),
  });
  await expect(dialog.getByLabel("新建SKILL.md")).toHaveValue(/name: report/);
  await dialog.getByRole("button", { name: "保存技能", exact: true }).click();
  const skill = dialog.locator(".detail-list li").filter({ hasText: "report" });
  await expect(skill).toContainText("此Bot未启用");
  await skill.getByRole("button", { name: "启用", exact: true }).click();
  await expect(skill).toContainText("此Bot已启用");
  const download = page.waitForEvent("download");
  await skill.getByRole("button", { name: "导出", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("report.md");
  await sections.getByRole("button", { name: "定时", exact: true }).click();
  await dialog.getByLabel("新任务名称").fill("早间报告");
  await dialog
    .getByLabel("工作要求与交付方式")
    .fill("整理报告，发回当前聊天。");
  await dialog.getByLabel("report", { exact: true }).check();
  await dialog.getByRole("button", { name: "保存为暂停", exact: true }).click();
  const routine = dialog
    .locator(".detail-list li")
    .filter({ has: page.getByRole("button", { name: "试跑", exact: true }) });
  await expect(routine).toContainText("已暂停");
  await routine.getByRole("button", { name: "启用", exact: true }).click();
  await expect(routine).toContainText("已启用");
  await routine.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(routine).toContainText("已暂停");
  await control({ content: "报告已交付。" });
  await routine.getByRole("button", { name: "试跑", exact: true }).click();
  await expect(dialog).toContainText("试跑 · 已完成");
  await sections.getByRole("button", { name: "提示词", exact: true }).click();
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
  await expect(page.getByLabel("你的消息")).toHaveText("试跑：早间报告");
  const port = Number(new URL(url).port);
  await stop();
  await start(port);
  await page.reload();
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await sections.getByRole("button", { name: "记忆", exact: true }).click();
  await expect(dialog.locator(".detail-list")).toContainText(
    "报告使用公制单位。",
  );
  await sections.getByRole("button", { name: "定时", exact: true }).click();
  await expect(dialog).toContainText("试跑 · 已完成");
});

test("Bot details retain invalid skill edits and fit a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(url);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const dialog = page.getByRole("complementary", { name: /的详情$/ });
  const sections = dialog.getByRole("navigation", { name: "Bot设置分区" });
  await sections.getByRole("button", { name: "技能", exact: true }).click();
  await dialog.getByLabel("新建SKILL.md").fill("invalid skill");
  await dialog.getByRole("button", { name: "保存技能", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("YAML");
  await expect(dialog.getByLabel("新建SKILL.md")).toHaveValue("invalid skill");
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
  await expect(dialog.getByLabel("名字", { exact: true })).toBeEnabled();
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/bot-work-mobile-dark.png" });
});

test("Bot details share the desktop with chat and cover narrow screens", async ({
  page,
}) => {
  await page.goto(url);
  const trigger = page.getByRole("button", { name: "Bot详情", exact: true });
  const panel = page.getByRole("complementary", { name: /的详情$/ });
  await trigger.click();
  await expect(panel.getByLabel("名字", { exact: true })).toBeEnabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const chat = page.locator(".conversation");
  const chatBox = await chat.boundingBox();
  const panelBox = await panel.boundingBox();
  if (!chatBox || !panelBox) throw new Error("Chat details layout missing");
  expect(panelBox.x).toBeCloseTo(chatBox.x + chatBox.width, 0);
  expect(panelBox.x + panelBox.width).toBeCloseTo(1360, 0);
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
  await panel.getByRole("button", { name: "提示词", exact: true }).click();
  await panel.getByRole("button", { name: "读取实际提示词" }).click();
  await panel.getByText("完整提示词", { exact: true }).click();
  await panel.locator(".detail-content").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect(
    await panel
      .locator(".detail-content")
      .evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0);
  await expect(input).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(chat).toBeHidden();
  await panel.getByRole("button", { name: "身份", exact: true }).click();
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

test("floating identity stays centered and settings belong to the details pane", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  const trigger = page.getByRole("button", { name: "Bot详情", exact: true });
  await expect(trigger).toHaveText("Domos");
  await expect(
    page.getByRole("combobox", { name: "模型", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "外观", exact: true }),
  ).toHaveCount(0);
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const pill = await trigger.boundingBox();
    const chat = await page.locator(".conversation").boundingBox();
    if (!pill || !chat) throw new Error("Missing floating identity");
    expect(pill.x + pill.width / 2).toBeCloseTo(chat.x + chat.width / 2, 0);
    expect(pill.height).toBeGreaterThanOrEqual(44);
    expect(pill.width).toBeLessThan(chat.width);
    expect(await page.locator("body").evaluate((el) => el.scrollWidth)).toBe(
      width,
    );
    await trigger.focus();
    await page.keyboard.press("Enter");
    const details = page.getByRole("complementary", { name: /的详情$/ });
    await expect(
      details.getByRole("combobox", { name: "模型", exact: true }),
    ).toBeEnabled();
    await expect(
      details.getByRole("combobox", { name: "外观", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `test-results/floating-identity-${width}.png`,
    });
    await details.focus();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  }
  expect(errors).toEqual([]);
});

test("contacts keep independent histories, drafts, models, and locations after restart", async ({
  page,
  context,
}) => {
  await page.goto(url);
  const input = page.getByLabel("消息", { exact: true });
  const send = page.getByRole("button", { name: "发送", exact: true });
  await expect(input).toBeEnabled();
  await input.fill("原来的对话");
  await send.click();
  await expect(page.getByLabel("Domos 的回复")).toContainText("完整回复。");
  await expect(send).toBeVisible();
  await input.fill("原来的草稿");
  const other = await context.newPage();
  await other.goto(url);
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
  await input.fill("研究问题");
  await send.click();
  await expect(page.getByLabel("研究员 的回复")).toContainText("faux-2");
  await expect(send).toBeVisible();
  await input.fill("研究草稿");
  await contacts.getByRole("link", { name: /^Domos/ }).click();
  await expect(input).toHaveValue("原来的草稿");
  await expectModel(page, "测试模型一");
  await createBot(page, "写作助手");
  await input.fill("写作问题");
  await send.click();
  await expect(page.getByLabel("写作助手 的回复")).toContainText("faux-1");
  await expect(send).toBeVisible();
  await input.fill("写作草稿");
  await contacts.getByRole("link", { name: "研究员", exact: true }).click();
  await expect(input).toHaveValue("研究草稿");
  await expect(page.getByLabel("你的消息")).toHaveText("研究问题");
  await expectModel(page, "测试模型二");
  await page.reload();
  await expect(input).toHaveValue("研究草稿");
  await other.close();
  const port = Number(new URL(url).port);
  await stop();
  await start(port);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  expect(page.url()).toBe(researchUrl);
  await expect(contacts.getByRole("link")).toHaveCount(3);
  await expect(page.getByLabel("研究员 的回复")).toContainText("faux-2");
  await contacts.getByRole("link", { name: "写作助手", exact: true }).click();
  await expect(input).toHaveValue("写作草稿");
  await expect(page.getByLabel("你的消息")).toHaveText("写作问题");
  await page.screenshot({ path: "test-results/bot-contacts.png" });
});

test("switching contacts keeps the first Bot running while another Bot replies", async ({
  page,
}) => {
  await page.goto(url);
  await createBot(page, "助手");
  const contacts = page.getByRole("navigation", {
    name: "联系人",
    exact: true,
  });
  await contacts.getByRole("link", { name: /^Domos/ }).click();
  const input = page.getByLabel("消息", { exact: true });
  const send = page.getByRole("button", { name: "发送", exact: true });
  await expect(input).toHaveAttribute("placeholder", "发送消息给 Domos…");
  await control("gate");
  await input.fill("后台任务");
  await send.click();
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  await contacts.getByRole("link", { name: "助手", exact: true }).click();
  await expect(input).toHaveAttribute("placeholder", "发送消息给 助手…");
  await input.fill("另一个任务");
  await send.click();
  await expect(page.getByLabel("助手 的回复")).toContainText("完整回复。");
  await expect(send).toBeVisible();
  await contacts.getByRole("link", { name: /^Domos/ }).click();
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  await control("release");
  await expect(page.getByLabel("Domos 的回复")).toContainText("后台任务");
  await expect(send).toBeVisible();
  await expect(page.getByLabel("你的消息")).toHaveText("后台任务");
});

test("creation retries keep one contact and themed dialogs work on narrow screens", async ({
  page,
}) => {
  await page.goto(url);
  const trigger = page.getByRole("button", { name: "新建 Bot", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "新建 Bot", exact: true });
  const name = dialog.getByLabel("名字", { exact: true });
  await expect(
    dialog.getByRole("button", { name: "换个形象", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  for (const theme of ["浅色", "深色"]) {
    await chooseAppearance(page, theme);
    await trigger.click();
    await name.fill("设计助手");
    await expect(
      dialog.getByRole("combobox", { name: "默认模型", exact: true }),
    ).toBeEnabled();
    await page.screenshot({ path: `test-results/bot-dialog-${theme}.png` });
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  let first = true;
  await page.route("**/rpc/bots/create", async (route) => {
    if (first) {
      first = false;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await openDetails(page);
  await trigger.click();
  await name.fill("设计助手");
  const create = dialog.getByRole("button", { name: "创建", exact: true });
  await expect(create).toBeEnabled();
  await page.screenshot({ path: "test-results/bot-dialog-mobile.png" });
  await create.click();
  await expect(dialog.getByRole("alert")).toContainText("创建未确认");
  await create.click();
  await expect(dialog).toHaveCount(0);
  await openDetails(page);
  const picker = page.getByRole("combobox", { name: "联系人", exact: true });
  await expect(picker).toContainText("设计助手");
  await picker.click();
  await expect(page.getByRole("option")).toHaveCount(2);
  await page.getByRole("option", { name: "Domos", exact: true }).click();
  await expect(page.getByLabel("消息", { exact: true })).toHaveAttribute(
    "placeholder",
    "发送消息给 Domos…",
  );
  await page.screenshot({ path: "test-results/bot-contacts-mobile.png" });
});

test("model choices load from the server and selection survives a restart", async ({
  page,
}) => {
  const subscription = Promise.withResolvers<void>();
  await page.route("**/rpc/subscribe", async (route) => {
    await subscription.promise;
    await route.continue();
  });
  await page.goto(url);
  const details = await openDetails(page);
  const picker = page.getByRole("combobox", { name: "模型", exact: true });
  await expect(picker).toBeDisabled();
  await expect(picker).not.toContainText("DeepSeek");
  subscription.resolve();
  await expect(picker).toBeEnabled();
  await picker.click();
  await page
    .getByRole("option", { name: "faux · 测试模型二", exact: true })
    .click();
  await expect(picker).toContainText("faux · 测试模型二");
  await page.reload();
  await openDetails(page);
  await expect(picker).toContainText("faux · 测试模型二");
  const port = Number(new URL(url).port);
  await stop();
  await start(port);
  await expect(picker).toBeEnabled();
  await details.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByLabel("消息", { exact: true }).fill("验证模型选择");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByLabel("Domos 的回复")).toContainText("faux-2");
});

test("send, reload, disconnect, reconnect and restart preserve the conversation", async ({
  page,
}) => {
  await page.goto(url);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  await page.screenshot({ path: "test-results/chat-desktop.png" });
  await control("gate");
  await page.getByLabel("消息", { exact: true }).fill("记住这句话");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("你的消息")).toContainText("记住这句话");
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  await page.goto("about:blank");
  await control("release");
  await page.goto(url);
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(0);
  await expect(page.getByLabel("Domos 的回复")).toContainText("完整回复。");
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/chat-conversation.png" });
  const port = Number(new URL(url).port);
  await stop();
  await start(port);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("Domos 的回复")).toContainText("记住这句话");
  await expect(page.getByLabel("你的消息")).toHaveCount(1);
});

test("a killed server resumes unfinished work and the page reconnects", async ({
  page,
}) => {
  await page.goto(url);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  await control("gate");
  await page.getByLabel("消息", { exact: true }).fill("恢复未完成任务");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  const contact = page.locator('.sidebar a[href="#bot/1"]');
  await expect(contact.getByRole("img", { name: "正在工作" })).toBeVisible();
  const port = Number(new URL(url).port);
  await stop();
  await expect(contact.locator(".avatar-status")).toHaveCount(0);
  await expect(page.locator(".sidebar-footer")).toContainText("正在重连");
  await start(port);
  await expect(page.getByLabel("Domos 的回复")).toContainText("完整回复。");
  await expect(page.getByLabel("你的消息")).toHaveCount(1);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  await expect(contact.locator(".avatar-status")).toHaveCount(0);
});

test("working contacts retain green status across switches, concurrent work, reload, and stop", async ({
  page,
}) => {
  await page.goto(url);
  const input = page.getByLabel("消息", { exact: true });
  await expect(input).toBeEnabled();
  await control("gate");
  await input.fill("后台任务");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const first = page.locator('.sidebar a[href="#bot/1"]');
  await expect(first.getByRole("img", { name: "正在工作" })).toBeVisible();
  await createBot(page, "第二位助手");
  const second = page
    .getByRole("navigation", { name: "联系人", exact: true })
    .getByRole("link", { name: "第二位助手" });
  await expect(first.locator(".avatar-status")).toBeVisible();
  await expect(second.locator(".avatar-status")).toHaveCount(0);
  await control("gate");
  await input.fill("另一个任务");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".sidebar .avatar-status")).toHaveCount(2);
  await page.reload();
  await expect(page.locator(".sidebar .avatar-status")).toHaveCount(2);
  for (const [theme, label] of [
    ["light", "浅色"],
    ["dark", "深色"],
  ] as const) {
    await chooseAppearance(page, label);
    const dot = first.locator(".avatar-status");
    const avatar = first.locator(".bot-avatar");
    const bounds = await dot.boundingBox();
    const frame = await avatar.boundingBox();
    if (!bounds || !frame) throw new Error("Working avatar missing");
    expect(bounds.x + bounds.width).toBeCloseTo(frame.x + frame.width, 0);
    expect(bounds.y + bounds.height).toBeCloseTo(frame.y + frame.height, 0);
    await page.screenshot({
      path: `test-results/contacts-${theme}-working.png`,
    });
  }
  await control("release");
  await expect(second.locator(".avatar-status")).toHaveCount(0);
  await expect(first.locator(".avatar-status")).toBeVisible();
  await first.click();
  await page.getByRole("button", { name: "停止生成", exact: true }).click();
  await expect(page.locator(".sidebar .avatar-status")).toHaveCount(0);
});

test("chat gutters stay full width while bubbles follow the available panel", async ({
  page,
}) => {
  const answer =
    "这是一段完整交付的长消息，用来检查聊天区域的可用宽度和自然换行。".repeat(
      5,
    );
  await control({ content: answer });
  await page.goto(url);
  const input = page.getByLabel("消息", { exact: true });
  await expect(input).toBeEnabled();
  await input.fill("请完整回复，检查长消息能使用规定的气泡宽度。".repeat(10));
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const reply = page.getByLabel("Domos 的回复").locator(".message-bubble");
  await expect(reply).toHaveText(answer);
  const outgoing = page.getByLabel("你的消息").locator(".message-bubble");
  for (const viewport of [
    { width: 1600, height: 900, incoming: 0.5, outgoing: 0.6 },
    { width: 940, height: 900, incoming: 0.88, outgoing: 0.88 },
    { width: 390, height: 844, incoming: 0.88, outgoing: 0.88 },
    { width: 320, height: 700, incoming: 0.88, outgoing: 0.88 },
  ]) {
    await page.setViewportSize(viewport);
    for (const [theme, label] of [
      ["light", "浅色"],
      ["dark", "深色"],
    ] as const) {
      await chooseAppearance(page, label);
      const panel = await page.locator(".conversation").boundingBox();
      const messages = await page.getByRole("log").boundingBox();
      const composer = await page.locator(".message-composer").boundingBox();
      const bubble = await reply.boundingBox();
      const sent = await outgoing.boundingBox();
      if (!panel || !messages || !composer || !bubble || !sent)
        throw new Error("Chat layout missing");
      expect(messages.x).toBeCloseTo(composer.x, 0);
      expect(messages.width).toBeCloseTo(composer.width, 0);
      expect(messages.width).toBeGreaterThanOrEqual(panel.width * 0.9);
      expect(bubble.width).toBeGreaterThan(
        messages.width * (viewport.incoming - 0.02),
      );
      expect(bubble.width).toBeLessThanOrEqual(
        messages.width * viewport.incoming + 1,
      );
      expect(sent.width).toBeGreaterThan(
        messages.width * (viewport.outgoing - 0.02),
      );
      expect(sent.width).toBeLessThanOrEqual(
        messages.width * viewport.outgoing + 1,
      );
      expect(sent.x + sent.width).toBeCloseTo(messages.x + messages.width, 0);
      expect(
        await page.locator("body").evaluate((element) => element.scrollWidth),
      ).toBe(viewport.width);
      await page.screenshot({
        path: `test-results/chat-density-${viewport.width}-${theme}.png`,
      });
    }
  }
});

test("a reply arrives complete while generation stays in the process across reloads", async ({
  page,
}) => {
  const answer = "完整回答。资料已经核对，以下内容一次交付。".repeat(8);
  await control({ content: answer });
  await page.addInitScript(() => {
    const frames: string[] = [];
    Object.assign(window, { replyFrames: frames });
    new MutationObserver(() => {
      for (const bubble of document.querySelectorAll(".message.assistant"))
        frames.push(bubble.textContent ?? "");
    }).observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  await page.goto(url);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  await page.getByLabel("消息", { exact: true }).fill("完整交付");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const process = page.getByRole("region", { name: "执行过程", exact: true });
  await expect(process.getByRole("status")).toHaveText("正在回复…");
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(0);
  await page.reload();
  await expect(process.getByRole("status")).toHaveText("正在回复…");
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(0);
  await expect(page.getByLabel("Domos 的回复")).toHaveText(answer);
  const frames = await page.evaluate(
    () => (window as unknown as { replyFrames: string[] }).replyFrames,
  );
  expect(frames.length).toBeGreaterThan(0);
  expect(new Set(frames)).toEqual(new Set([answer]));
  await expect(process).toHaveCount(0);
  const port = Number(new URL(url).port);
  await stop();
  await start(port);
  await page.reload();
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(1);
  await expect(page.getByLabel("Domos 的回复")).toHaveText(answer);
});

test("stopping generation keeps its partial out of reply bubbles after reload", async ({
  page,
}) => {
  await control({ content: "这份尚未生成完毕的回答。".repeat(30) });
  await page.goto(url);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  await page.getByLabel("消息", { exact: true }).fill("停止这次回答");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const process = page.getByRole("region", { name: "执行过程", exact: true });
  await expect(process.getByRole("status")).toHaveText("正在回复…");
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(0);
  await page.getByRole("button", { name: "停止生成", exact: true }).click();
  await expect(process).toHaveAttribute("data-state", "stopped");
  await expect(process.locator(":scope > details")).not.toHaveAttribute("open");
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(0);
  await page.reload();
  await expect(process).toHaveAttribute("data-state", "stopped");
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(0);
});

test("stop and Chinese input work on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  await control("gate");
  const input = page.getByLabel("消息", { exact: true });
  await input.fill("中文输入");
  await input.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: true,
  });
  await expect(page.getByLabel("你的消息")).toHaveCount(0);
  await input.press("Shift+Enter");
  await expect(input).toHaveValue("中文输入\n");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  await page.getByRole("button", { name: "停止生成" }).click();
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("你的消息")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "停止生成" })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/chat-mobile.png" });
});

test("retrying a send with a lost receipt does not repeat the message", async ({
  page,
}) => {
  await page.goto(url);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  await page.route("**/rpc/send", async (route) => {
    await route.fetch();
    await route.abort();
    await page.unroute("**/rpc/send");
  });
  await page.getByLabel("消息", { exact: true }).fill("同一条请求");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("发送未确认");
  await expect(page.getByLabel("Domos 的回复")).toContainText("完整回复。");
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("发送未确认");
  await page.getByRole("button", { name: "重试发送", exact: true }).click();
  await expect(page.getByLabel("消息", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("你的消息")).toHaveCount(1);
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(1);
});

test("drafts survive reload and reopening in the same browser", async ({
  page,
  context,
}) => {
  await page.goto(url);
  const input = page.getByLabel("消息", { exact: true });
  await input.fill("尚未发送的想法");
  await page.reload();
  await expect(input).toHaveValue("尚未发送的想法");
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(url);
  await expect(reopened.getByLabel("消息", { exact: true })).toHaveValue(
    "尚未发送的想法",
  );
  await expect(reopened.getByLabel("你的消息")).toHaveCount(0);
});

test("editing during a send preserves the next draft", async ({ page }) => {
  await page.goto(url);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  const receipt = Promise.withResolvers<void>();
  const sent = Promise.withResolvers<void>();
  await page.route("**/rpc/send", async (route) => {
    const response = await route.fetch();
    sent.resolve();
    await receipt.promise;
    await route.fulfill({ response });
  });
  const input = page.getByLabel("消息", { exact: true });
  await input.fill("第一条消息");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await sent.promise;
  await input.fill("下一条草稿");
  receipt.resolve();
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue("下一条草稿");
  await page.reload();
  await expect(input).toHaveValue("下一条草稿");
});

test("storage failures keep the draft and prevent an unrecorded send", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Blocked", "SecurityError");
    };
  });
  await page.goto(url);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  const input = page.getByLabel("消息", { exact: true });
  await input.fill("保留在输入框");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("草稿保存失败");
  await expect(input).toHaveValue("保留在输入框");
  await expect(page.getByLabel("你的消息")).toHaveCount(0);
});

test("a busy conversation shows the server rejection and keeps the draft", async ({
  page,
  browser,
}) => {
  await page.goto(url);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  const other = await browser.newPage();
  await other.goto(url);
  await expect(other.getByLabel("消息", { exact: true })).toBeEnabled();
  await control("gate");
  await page.route("**/rpc/send", async (route) => {
    await other.getByLabel("消息", { exact: true }).fill("占用会话");
    await other.getByRole("button", { name: "发送", exact: true }).click();
    await expect(other.getByRole("button", { name: "停止生成" })).toBeVisible();
    await route.continue();
  });
  await page.getByLabel("消息", { exact: true }).fill("被拒绝的消息");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("会话正在回复");
  await expect(page.getByRole("alert")).not.toContainText("发送未确认");
  await expect(page.getByLabel("消息", { exact: true })).toHaveValue(
    "被拒绝的消息",
  );
  await page.unroute("**/rpc/send");
  await other.getByRole("button", { name: "停止生成" }).click();
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeVisible();
  await other.close();
});

test("text contrast, keyboard focus and message scrolling meet the UI contract", async ({
  page,
}) => {
  await page.goto(url);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  await expectTextContrast(page);
  const details = await openDetails(page);
  const picker = page.getByRole("combobox", { name: "模型", exact: true });
  const restingBorder = await page
    .locator(".composer-field")
    .evaluate((element) => getComputedStyle(element).borderColor);
  await picker.focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "连接模型", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("combobox", { name: "外观" })).toBeFocused();
  await expect(
    page.getByRole("button", { name: "添加文件", exact: true }),
  ).toBeEnabled();
  await details.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "添加文件", exact: true }).focus();
  await expect(
    page.getByRole("button", { name: "添加文件", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  const input = page.getByLabel("消息", { exact: true });
  await expect(input).toBeFocused();
  await expect(input).toHaveCSS("outline-style", "none");
  await expect
    .poll(() =>
      page
        .locator(".composer-field")
        .evaluate((element) => getComputedStyle(element).borderColor),
    )
    .not.toBe(restingBorder);
  await input.fill("长消息\n".repeat(80));
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".transcript")
        .evaluate((element) => element.scrollHeight > element.clientHeight),
    )
    .toBe(true);
  await page.locator(".transcript").evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(page.getByRole("button", { name: "返回最新" })).toBeVisible();
  await page.getByRole("button", { name: "停止生成" }).click();
  await page.getByRole("button", { name: "返回最新" }).click();
  await expect(page.getByRole("button", { name: "返回最新" })).toHaveCount(0);
});

test("appearance follows the system, persists, and syncs between tabs", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(url);
  const root = page.locator("html");
  await openDetails(page);
  const appearance = page.getByRole("combobox", { name: "外观" });
  await expect(appearance).toContainText("跟随系统");
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(root).toHaveAttribute("data-theme", "dark");
  await chooseAppearance(page, "浅色");
  await page.reload();
  await openDetails(page);
  await expect(appearance).toContainText("浅色");
  await expect(root).toHaveAttribute("data-theme", "light");
  const other = await context.newPage();
  await other.goto(url);
  await openDetails(other);
  await expect(other.getByRole("combobox", { name: "外观" })).toContainText(
    "浅色",
  );
  await chooseAppearance(page, "深色");
  await expect(other.locator("html")).toHaveAttribute("data-theme", "dark");
  await other.close();
});

test("appearance remains usable when storage is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new DOMException("Blocked", "SecurityError");
    };
    Storage.prototype.setItem = () => {
      throw new DOMException("Blocked", "SecurityError");
    };
  });
  await page.goto(url);
  await openDetails(page);
  await chooseAppearance(page, "浅色");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(
    page.getByRole("alert").filter({ hasText: "外观已应用" }),
  ).toBeVisible();
});

test("composer grows, shrinks, and keeps one focus surface in both themes", async ({
  page,
}) => {
  await page.goto(url);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  const input = page.getByLabel("消息", { exact: true });
  const form = page.locator(".message-composer");
  const initial = await form.boundingBox();
  expect(initial?.height).toBeGreaterThanOrEqual(44);
  expect(initial?.height).toBeLessThanOrEqual(50);
  const add = page.getByRole("button", { name: "添加文件", exact: true });
  const fieldBox = await page.locator(".composer-field").boundingBox();
  const addBox = await add.boundingBox();
  if (!fieldBox || !addBox) throw new Error("Composer controls missing");
  expect(addBox.x + addBox.width).toBeLessThan(fieldBox.x);
  expect(addBox.width).toBe(addBox.height);
  expect(addBox.height).toBeCloseTo(fieldBox.height, 0);
  expect(
    await page.locator(".composer-field").getByRole("button").count(),
  ).toBe(1);
  await input.fill(
    Array.from({ length: 12 }, (_, index) => `第 ${index + 1} 行内容`).join(
      "\n",
    ),
  );
  await expect
    .poll(async () => (await form.boundingBox())?.height ?? 0)
    .toBeGreaterThan(initial?.height ?? 0);
  await expect(input).toHaveCSS("resize", "none");
  const field = await input.boundingBox();
  expect(field?.height).toBeLessThanOrEqual(160);
  await input.fill("");
  await expect
    .poll(async () => (await form.boundingBox())?.height)
    .toBe(initial?.height);
  for (const [theme, label] of [
    ["light", "浅色"],
    ["dark", "深色"],
  ] as const) {
    await chooseAppearance(page, label);
    await expectTextContrast(page);
    await input.focus();
    await expect(input).toHaveCSS("outline-style", "none");
    await page.screenshot({ path: `test-results/workspace-${theme}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(input).toBeVisible();
  const action = await page
    .getByRole("button", { name: "发送", exact: true })
    .boundingBox();
  expect(action?.width).toBeGreaterThanOrEqual(44);
  expect(action?.height).toBeGreaterThanOrEqual(44);
  expect((await form.boundingBox())?.height).toBeLessThanOrEqual(50);
  await expect(
    page.getByRole("button", { name: "Bot详情", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/workspace-mobile.png" });
});

test("structured messages show Markdown, thinking, tool states, and restored results", async ({
  page,
}) => {
  const markdown =
    "## 调研结果\n\n**重点**与[官方资料](https://example.com)。\n\n| 项目 | 状态 |\n| --- | --- |\n| 调研 | 完成 |\n\n```ts\nconst ready = true;\n```\n\n<script>window.injected = true</script>\n\n[危险链接](javascript:alert(1))";
  await control({
    content: [
      {
        type: "thinking",
        thinking: "核对已有资料。",
        thinkingSignature: "private-signature",
      },
      { type: "text", text: markdown },
    ],
  });
  await page.goto(url);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  await page.getByLabel("消息", { exact: true }).fill("检查排版");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const response = page.getByLabel("Domos 的回复");
  await expect(response.locator("strong")).toHaveText("重点");
  await expect(response.getByRole("table")).toBeVisible();
  await expect(response.locator("pre code")).toHaveText("const ready = true;");
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeVisible();
  await page.getByText("已思考", { exact: true }).click();
  await expect(page.getByText("核对已有资料。", { exact: true })).toBeVisible();
  await expect(
    response.getByRole("link", { name: "官方资料" }),
  ).toHaveAttribute("href", "https://example.com");
  await expect(response.locator("script")).toHaveCount(0);
  await expect(
    response.getByRole("link", { name: "危险链接" }),
  ).not.toHaveAttribute("href", /^javascript:/);
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeVisible();
  await control("gate-tool");
  const callId = crypto.randomUUID();
  await control({
    stopReason: "toolUse",
    content: [
      {
        type: "toolCall",
        id: callId,
        name: toolName,
        arguments: { text: "**工具结果**", fail: true },
      },
    ],
  });
  await page.getByLabel("消息", { exact: true }).fill("调用工具");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const process = page
    .getByRole("region", { name: "执行过程", exact: true })
    .last();
  await expect(process.getByRole("status")).toContainText(toolName);
  await control("release");
  await expect(process).toHaveAttribute("data-state", "failed");
  await expect(process.getByText("1 项失败", { exact: true })).toBeVisible();
  await process.locator(":scope > details > summary").click();
  const result = process.locator(".activity-content > details");
  await result.locator("summary").click();
  await expect(result.locator("strong")).toHaveText("工具结果");
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/workspace-content.png" });
  await page.reload();
  await expect(page.getByText("1 项失败", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "调研结果" })).toBeVisible();
});

test("Markdown keeps one message scale across elements, themes, and text enlargement", async ({
  page,
}) => {
  const markdown = [
    "# 一级标题",
    "## 二级标题",
    "### 三级标题",
    "#### 四级标题",
    "##### 五级标题",
    "###### 六级标题",
    "普通段落，**重点**，以及[资料](https://example.com)。",
    "- 列表内容\n- 第二项",
    "> 引用内容",
    "| 项目 | 状态 |\n| --- | --- |\n| 排版 | 完成 |",
    ["```txt", "x".repeat(200), "```"].join("\n"),
  ].join("\n\n");
  await control({ content: markdown });
  await page.goto(url);
  const input = page.getByLabel("消息", { exact: true });
  await expect(input).toBeEnabled();
  await input.fill("请保留全部内容格式。");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const reply = page.getByLabel("Domos 的回复");
  await expect(reply.getByRole("heading")).toHaveCount(6);
  const expectScale = async (size: number) => {
    const values = await reply.evaluate((element) =>
      [
        ...element.querySelectorAll(
          "h1,h2,h3,h4,h5,h6,p,li,blockquote,th,td,code",
        ),
      ].map((node) => Number.parseFloat(getComputedStyle(node).fontSize)),
    );
    for (const value of values) expect(value).toBe(size);
    const code = await reply.locator("pre").evaluate((element) => ({
      content: element.scrollWidth,
      frame: element.clientWidth,
      overflow: getComputedStyle(element).overflowX,
    }));
    expect(code.content).toBeGreaterThan(code.frame);
    expect(code.overflow).toBe("auto");
    expect(
      await page.locator("body").evaluate((element) => element.scrollWidth),
    ).toBe(await page.evaluate(() => innerWidth));
  };
  for (const [width, size] of [
    [1600, 14],
    [390, 15],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    for (const [theme, label] of [
      ["light", "浅色"],
      ["dark", "深色"],
    ] as const) {
      await chooseAppearance(page, label);
      await expectScale(size);
      await page.getByRole("log").evaluate((element) => {
        element.closest(".transcript")?.scrollTo(0, 0);
      });
      await page.screenshot({
        path: `test-results/message-scale-${width}-${theme}.png`,
      });
    }
  }
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.addStyleTag({ content: ":root { font-size: 200%; }" });
  await expect(page.locator("html")).toHaveCSS("font-size", "32px");
  await expectScale(30);
  await expect(input).toBeVisible();
  await input.fill("放大后仍可编辑。");
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeEnabled();
});

test("bundled Chinese and Latin faces render fractional message weights", async ({
  page,
}) => {
  await control({ content: "中文消息与 Latin 文字。**重点内容**" });
  await page.goto(url);
  await page.getByLabel("消息", { exact: true }).fill("检查字体");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const paragraph = page.getByLabel("Domos 的回复").locator("p");
  await expect(paragraph).toContainText("中文消息与 Latin 文字。");
  await page.evaluate(() => document.fonts.ready);
  await expect(paragraph).toHaveCSS("font-weight", "320");
  await expect(paragraph.locator("strong")).toHaveCSS("font-weight", "450");
  const session = await page.context().newCDPSession(page);
  await session.send("DOM.enable");
  await session.send("CSS.enable");
  const { root } = await session.send("DOM.getDocument");
  const { nodeId } = await session.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: ".message.assistant .markdown p",
  });
  const { fonts } = await session.send("CSS.getPlatformFontsForNode", {
    nodeId,
  });
  for (const family of ["Noto Sans SC", "Geist"]) {
    expect(
      fonts.some(
        (font) =>
          font.isCustomFont &&
          font.glyphCount > 0 &&
          font.familyName.includes(family),
      ),
    ).toBe(true);
  }
  const loaded = await page.evaluate(
    () =>
      [...document.fonts].filter(
        (font) =>
          font.family.includes("Noto Sans SC") && font.status === "loaded",
      ).length,
  );
  expect(loaded).toBeGreaterThan(0);
  await page.screenshot({ path: "test-results/chat-fonts.png" });
  await session.detach();
});

test("message text remains readable when bundled Chinese fonts cannot load", async ({
  page,
}) => {
  await page.route("**/*noto-sans-sc*.woff2", (route) => route.abort());
  await control({ content: "字体回退后，中文与 Latin 仍然可读。" });
  await page.goto(url);
  const input = page.getByLabel("消息", { exact: true });
  await input.fill("检查字体回退");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const reply = page.getByLabel("Domos 的回复");
  await expect(reply).toHaveText("字体回退后，中文与 Latin 仍然可读。");
  await page.evaluate(() => document.fonts.ready);
  const failed = await page.evaluate(() =>
    [...document.fonts].some(
      (font) => font.family.includes("Noto Sans SC") && font.status === "error",
    ),
  );
  expect(failed).toBe(true);
  await expect(input).toBeEnabled();
  await page.screenshot({ path: "test-results/chat-font-fallback.png" });
});

test("measured text sizing grows with wrapping and resets after clearing", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const supports = CSS.supports.bind(CSS);
    CSS.supports = ((property: string, value?: string) =>
      property === "field-sizing"
        ? false
        : value === undefined
          ? supports(property)
          : supports(property, value)) as typeof CSS.supports;
  });
  await page.goto(url);
  await page.addStyleTag({
    content: ".message-composer textarea { field-sizing: fixed; }",
  });
  const input = page.getByLabel("消息", { exact: true });
  await expect(input).toBeVisible();
  const initial = await input.boundingBox();
  await input.fill("按内容自动调整输入区高度。".repeat(12));
  await expect
    .poll(async () => (await input.boundingBox())?.height ?? 0)
    .toBeGreaterThan(initial?.height ?? 0);
  const expanded = await input.boundingBox();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => (await input.boundingBox())?.height ?? 0)
    .toBeGreaterThanOrEqual(expanded?.height ?? 0);
  await page.setViewportSize({ width: 1360, height: 900 });
  await input.fill("");
  await expect
    .poll(async () => (await input.boundingBox())?.height)
    .toBe(initial?.height);
});

test("model search and themed popups support keyboard, dismissal, and narrow screens", async ({
  page,
}) => {
  await page.goto(url);
  await openDetails(page);
  const model = page.getByRole("combobox", { name: "模型", exact: true });
  const appearance = page.getByRole("combobox", { name: "外观", exact: true });
  await expect(model).toBeEnabled();
  await model.focus();
  await page.keyboard.press("Enter");
  const search = page.getByRole("combobox", { name: "搜索模型…", exact: true });
  await expect(search).toBeFocused();
  await search.fill(crypto.randomUUID());
  await expect(page.getByText("没有找到模型", { exact: true })).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(0);
  await search.fill("测试模型二");
  await expect(page.getByRole("option")).toHaveCount(1);
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(model).toContainText("测试模型二");
  await expect(search).toHaveCount(0);
  await expect(model).toBeFocused();
  await model.click();
  await expect(search).toHaveValue("");
  await search.press("Escape");
  await expect(model).toBeFocused();
  await appearance.click();
  await expect(page.getByRole("option")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(appearance).toBeFocused();
  await expect(page.locator("select:visible")).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 568 });
  await model.click();
  const popup = page.locator(".picker-search-popup");
  await expect(popup).toBeVisible();
  const bounds = await popup.boundingBox();
  if (!bounds) throw new Error("Popup is not visible");
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(568);
  await page.screenshot({ path: "test-results/model-popup-mobile.png" });
  await page.locator(".detail-header h2").click();
  await expect(popup).toHaveCount(0);
});

test("IM bubbles, sidebar search, and popup surfaces share both themes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await control({
    content:
      "**已整理好。**\n\n- 核对参考源码\n- 统一交互与主题\n- 验证窄屏和键盘\n\n```ts\nconst result = { status: 'complete', message: '内容在气泡内展示' };\n```\n\n接下来可以直接继续对话。",
  });
  await page.goto(url);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  await page.getByLabel("消息", { exact: true }).fill("帮我整理一下");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("button", { name: "停止生成" })).toHaveCount(0);
  const incoming = page.getByLabel("Domos 的回复").locator(".message-bubble");
  const outgoing = page.getByLabel("你的消息").locator(".message-bubble");
  await expect(incoming.locator("strong")).toHaveText("已整理好。");
  const column = await page.getByRole("log").boundingBox();
  const received = await incoming.boundingBox();
  const sent = await outgoing.boundingBox();
  if (!column || !received || !sent)
    throw new Error("Messages are not visible");
  expect(sent.width).toBeLessThan(200);
  expect(received.x).toBe(column.x);
  expect(received.width).toBeLessThanOrEqual(column.width * 0.5 + 1);
  expect(sent.x + sent.width).toBeCloseTo(column.x + column.width, 0);
  const search = page.getByRole("searchbox", { name: "搜索联系人" });
  await search.fill(crypto.randomUUID());
  await expect(page.getByText("没有找到联系人", { exact: true })).toBeVisible();
  const navigation = page.getByRole("navigation", {
    name: "联系人",
    exact: true,
  });
  await expect(navigation.getByRole("link")).toHaveCount(0);
  await search.fill("统一交互");
  await expect(navigation.getByRole("link")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await search.fill("");
  for (const [theme, label] of [
    ["light", "浅色"],
    ["dark", "深色"],
  ] as const) {
    await chooseAppearance(page, label);
    await expectTextContrast(page);
    await page.screenshot({ path: `test-results/im-${theme}.png` });
    const details = await openDetails(page);
    await page.getByRole("combobox", { name: "模型", exact: true }).click();
    await expect(page.getByRole("option").first()).toBeVisible();
    await expectTextContrast(page);
    await page.screenshot({ path: `test-results/im-model-${theme}.png` });
    await page.keyboard.press("Escape");
    await page.getByRole("combobox", { name: "外观", exact: true }).click();
    await expect(
      page.getByRole("option", { name: label, exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: `test-results/im-appearance-${theme}.png` });
    await page.keyboard.press("Escape");
    await details.getByRole("button", { name: "关闭", exact: true }).click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/im-mobile.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("latest bubbles stay above the composer after typing, resizing, and reloading", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1360, height: 700 });
  await page.goto(url);
  const input = page.getByLabel("消息", { exact: true });
  const send = page.getByRole("button", { name: "发送", exact: true });
  await expect(send).toBeDisabled();
  for (let turn = 0; turn < 2; turn++) {
    await control({
      content: Array.from(
        { length: 8 },
        (_, index) => `第 ${index + 1} 项：核对源码，统一消息布局。`,
      ).join("\n\n"),
    });
    await input.fill(`整理第 ${turn + 1} 轮结果`);
    await send.click();
    const replies = page.getByLabel("Domos 的回复");
    await expect(replies).toHaveCount(turn + 1);
    await expect(replies.last()).toContainText(
      "第 8 项：核对源码，统一消息布局。",
    );
    await expect(send).toBeVisible();
  }
  const last = page.getByLabel("Domos 的回复").last();
  const expectLatest = async () => {
    await expect
      .poll(() =>
        last.evaluate((element) => {
          const viewport = element.closest(".transcript");
          if (!viewport) throw new Error("Missing transcript");
          const dock = document.querySelector(".composer-area");
          if (!dock) throw new Error("Missing composer dock");
          return (
            element.getBoundingClientRect().bottom <=
            dock.getBoundingClientRect().top
          );
        }),
      )
      .toBe(true);
    await expect(page.getByRole("button", { name: "返回最新" })).toHaveCount(0);
  };
  await expectLatest();
  await input.fill(
    Array.from({ length: 12 }, (_, index) => `草稿第 ${index + 1} 行`).join(
      "\n",
    ),
  );
  await expectLatest();
  await page.setViewportSize({ width: 390, height: 700 });
  await expectLatest();
  await input.fill("");
  await page.locator('input[type="file"]').setInputFiles({
    name: "布局.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("附件增加输入区高度。"),
  });
  const remove = page.getByRole("button", {
    name: "移除文件 布局.txt",
    exact: true,
  });
  await expect(remove).toBeVisible();
  await expectLatest();
  await remove.click();
  await expectLatest();
  await page.setViewportSize({ width: 390, height: 400 });
  await expectLatest();
  await page.setViewportSize({ width: 390, height: 700 });
  await page.reload();
  await expectLatest();
  await page.locator(".transcript").evaluate((element) => {
    element.scrollTop = 0;
  });
  const latest = page.getByRole("button", { name: "返回最新" });
  await expect(latest).toBeVisible();
  const heightBefore = await page
    .locator(".transcript")
    .evaluate((element) => element.scrollHeight);
  await latest.click();
  await expectLatest();
  expect(
    await page
      .locator(".transcript")
      .evaluate((element) => element.scrollHeight),
  ).toBe(heightBefore);
  await page.screenshot({ path: "test-results/chat-spacing-mobile.png" });
});

test("composer fades scrolling messages and covers content below its edge", async ({
  page,
}) => {
  const media = await page.context().newCDPSession(page);
  await media.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-reduced-transparency", value: "no-preference" },
    ],
  });
  await control({
    content: [
      {
        type: "text",
        text: Array.from(
          { length: 30 },
          (_, index) => `[查看记录 ${index}](#${index})`,
        ).join("\n\n"),
      },
    ],
  });
  await page.goto(url);
  await page.getByLabel("消息", { exact: true }).fill("查看记录");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByLabel("Domos 的回复").getByRole("link")).toHaveCount(
    30,
  );
  for (const width of [1360, 390]) {
    await page.setViewportSize({ width, height: 700 });
    for (const label of ["浅色", "深色"]) {
      await chooseAppearance(page, label);
      const point = await page.evaluate(() => {
        const dock = document.querySelector(".composer-area");
        const transcript = document.querySelector(".transcript");
        const link = [
          ...document.querySelectorAll<HTMLAnchorElement>(
            ".message.assistant a",
          ),
        ].at(-1);
        if (!dock || !transcript || !link)
          throw new Error("Missing chat geometry");
        const target =
          dock.getBoundingClientRect().top +
          Number.parseFloat(getComputedStyle(dock).paddingTop) / 2;
        transcript.scrollTop +=
          link.getBoundingClientRect().top +
          link.getBoundingClientRect().height / 2 -
          target;
        const rect = link.getBoundingClientRect();
        return {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          target,
        };
      });
      expect(
        await page.evaluate(
          ({ x, y }) =>
            document.elementFromPoint(x, y)?.closest("a")?.textContent,
          point,
        ),
      ).toBeUndefined();
      expect(Math.abs(point.y - point.target)).toBeLessThanOrEqual(1);
      const scroll = await page
        .locator(".transcript")
        .evaluate((element) => element.scrollTop);
      const fade = await page.locator(".composer-area").evaluate((element) => {
        const style = getComputedStyle(element, "::before");
        return {
          blur: style.backdropFilter,
          mask: style.maskImage,
          surface: getComputedStyle(element).backgroundColor,
        };
      });
      expect(fade.blur).toContain("blur");
      expect(fade.mask).toContain("linear-gradient");
      expect(fade.surface).not.toBe("rgba(0, 0, 0, 0)");
      await page.mouse.move(point.x, point.y - 100);
      await page.mouse.wheel(0, -100);
      await expect
        .poll(() =>
          page.locator(".transcript").evaluate((element) => element.scrollTop),
        )
        .toBeLessThan(scroll);
      const pane = await page.locator(".transcript-pane").boundingBox();
      expect(pane && Math.round(pane.y + pane.height)).toBe(700);
      await page.screenshot({
        path: `test-results/floating-composer-${width}-${label}.png`,
      });
    }
  }
});

test("file drafts, real tools, and published downloads survive Bot switches and restart", async ({
  page,
}) => {
  await page.goto(url);
  const input = page.getByLabel("消息", { exact: true });
  const send = page.getByRole("button", { name: "发送", exact: true });
  await expect(
    page.getByRole("button", { name: "添加文件", exact: true }),
  ).toBeEnabled();
  const source = `Source ${crypto.randomUUID()}`;
  await page.locator('input[type="file"]').setInputFiles({
    name: "资料.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(source),
  });
  await expect(
    page.getByRole("button", { name: "移除文件 资料.txt", exact: true }),
  ).toBeEnabled();
  const file = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) =>
      key.startsWith("domos:composer:v1:"),
    );
    return JSON.parse(localStorage.getItem(key ?? "") ?? "{}")
      .attachments[0] as { id: string; path: string };
  });
  const primary = page.url();
  await input.fill("整理成报告");
  await page.reload();
  await expect(input).toHaveValue("整理成报告");
  await expect(
    page.getByRole("button", { name: "移除文件 资料.txt", exact: true }),
  ).toBeVisible();
  await createBot(page, "其他助手");
  await expect(page.locator(".composer-attachments")).toHaveCount(0);
  await page.goto(primary);
  await expect(input).toHaveValue("整理成报告");
  const call = (name: string, args: Record<string, unknown>) => ({
    type: "toolCall",
    id: crypto.randomUUID(),
    name,
    arguments: args,
  });
  await control({
    responses: [
      { content: [call("read", { path: file.path })], stopReason: "toolUse" },
      {
        content: [
          call("write", { path: "report.md", content: `# Draft\n${source}` }),
        ],
        stopReason: "toolUse",
      },
      {
        content: [
          call("edit", {
            path: "report.md",
            edits: [{ oldText: "# Draft", newText: "# Report" }],
          }),
          call("attach_file", { path: "report.md" }),
        ],
        stopReason: "toolUse",
      },
      { content: "报告已完成。" },
    ],
  });
  await expect(send).toBeEnabled();
  await send.click();
  const report = page.getByRole("button", {
    name: "下载 report.md",
    exact: true,
  });
  await expect(report).toBeVisible();
  await expect(send).toBeVisible();
  await expect(input).toHaveValue("");
  await expect(page.locator(".composer-attachments")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "下载 资料.txt", exact: true }),
  ).toBeVisible();
  const activity = page.getByRole("region", { name: "执行过程", exact: true });
  await expect(activity).toHaveCount(1);
  await expect(activity.locator(":scope > details > summary")).toHaveText(
    "已完成 4 项操作",
  );
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(1);
  await expect(page.locator(".message.toolResult")).toHaveCount(0);
  await activity.locator(":scope > details > summary").click();
  const read = activity.locator(".activity-content > details").first();
  await read.locator("summary").click();
  await expect(read).toContainText(source);
  await activity.locator(":scope > details > summary").click();
  await chooseAppearance(page, "深色");
  await page.screenshot({
    path: "test-results/files-dark.png",
    fullPage: true,
  });
  await expectTextContrast(page);
  await chooseAppearance(page, "浅色");
  await page.screenshot({
    path: "test-results/files-light.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await report.scrollIntoViewIfNeeded();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({
    path: "test-results/files-mobile.png",
    fullPage: true,
  });
  const port = Number(new URL(url).port);
  await stop();
  await start(port);
  await page.reload();
  await expect(report).toBeEnabled();
  const downloaded = page.waitForEvent("download");
  await report.click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("report.md");
  expect(await readFile(await download.path(), "utf8")).toBe(
    `# Report\n${source}`,
  );
});

test("tool progress follows the Bot and stop and restart retain accurate results", async ({
  page,
}) => {
  await page.goto(url);
  const primary = page.url();
  const input = page.getByLabel("消息", { exact: true });
  const send = page.getByRole("button", { name: "发送", exact: true });
  await expect(
    page.getByRole("button", { name: "添加文件", exact: true }),
  ).toBeEnabled();
  const call = (path: string) => ({
    content: [
      {
        type: "toolCall",
        id: crypto.randomUUID(),
        name: "write",
        arguments: { path, content: "result" },
      },
    ],
    stopReason: "toolUse" as const,
  });
  await control("gate-tool");
  await control(call("stopped.md"));
  await input.fill("生成文件");
  await send.click();
  const running = page.locator('.execution-activity[data-state="running"]');
  await expect(running.getByRole("status")).toContainText("正在执行 · write");
  await createBot(page, "旁观助手");
  await expect(running).toHaveCount(0);
  await page.goto(primary);
  await expect(running.getByRole("status")).toContainText("正在执行 · write");
  await page.getByRole("button", { name: "停止生成", exact: true }).click();
  await expect(send).toBeVisible();
  await expect(
    page.locator(".execution-activity > details > summary"),
  ).toHaveText("已停止");
  await control("gate-tool");
  await control(call("interrupted.md"));
  await input.fill("再次生成");
  await send.click();
  await expect(running.getByRole("status")).toContainText("正在执行 · write");
  const port = Number(new URL(url).port);
  await stop();
  await start(port);
  await page.reload();
  await expect(send).toBeVisible();
  await expect(
    page.locator('.execution-activity[data-state="failed"]'),
  ).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^下载/ })).toHaveCount(0);
  await expect(
    page.locator(
      '.execution-activity[data-state="stopped"] > details > summary',
    ),
  ).toHaveText("已停止");
  await control(call("../escape.md"));
  await input.fill("检查文件边界");
  await send.click();
  await expect(
    page.locator('.execution-activity[data-state="failed"]'),
  ).toHaveCount(2);
  await expect(send).toBeVisible();
});

test("one live process shares motion, keyboard disclosure, themes, and restored results", async ({
  page,
}) => {
  await control("gate-tool");
  await control({
    responses: [
      {
        stopReason: "toolUse",
        content: [
          {
            type: "thinking",
            thinking: "核对资料的内容与来源。",
            thinkingSignature: "signature",
          },
          { type: "text", text: "先核对资料，再整理结果。" },
          {
            type: "toolCall",
            id: crypto.randomUUID(),
            name: toolName,
            arguments: { text: "已核对完整资料。" },
          },
        ],
      },
      { content: "**整理完成。**\n\n资料已核对，可以继续修改。" },
    ],
  });
  await page.goto(url);
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("消息", { exact: true }).fill("核对并整理资料");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const process = page.getByRole("region", { name: "执行过程", exact: true });
  const trigger = process.getByRole("button", { name: "Domos 正在工作" });
  const status = process.getByRole("status");
  await expect(process).toHaveCount(1);
  await expect(status).toContainText(`正在执行 · ${toolName}`);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".composer-area")).toContainText("Domos 正在工作");
  await expect(
    page.getByRole("log").locator(".execution-activity"),
  ).toHaveCount(0);
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(0);
  await expect(trigger.locator(".bot-avatar")).toHaveCount(1);
  await expect(trigger.locator(".activity-label")).toHaveCSS(
    "animation-name",
    "activity-sweep",
  );
  await expect(trigger.locator(".character-body")).toHaveCSS(
    "animation-name",
    "character-breathe",
  );
  for (const [theme, label] of [
    ["dark", "深色"],
    ["light", "浅色"],
  ] as const) {
    await chooseAppearance(page, label);
    await trigger.hover();
    await expect(page.locator(".work-tooltip")).toHaveText(
      `正在执行 · ${toolName}`,
    );
    await page.screenshot({ path: `test-results/activity-${theme}-live.png` });
    await trigger.focus();
    await trigger.press("Space");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(
      process.getByText("先核对资料，再整理结果。", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `test-results/activity-${theme}-expanded.png`,
    });
    await trigger.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(trigger.locator(".activity-label")).toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(trigger.locator(".character-body")).toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(trigger.locator(".activity-label")).not.toHaveCSS(
    "color",
    "rgba(0, 0, 0, 0)",
  );
  await page.emulateMedia({ forcedColors: "active" });
  await expect(trigger.locator(".activity-label")).not.toHaveCSS(
    "color",
    "rgba(0, 0, 0, 0)",
  );
  await page.emulateMedia({
    forcedColors: "none",
    reducedMotion: "no-preference",
  });
  await page.reload();
  await expect(status).toContainText(`正在执行 · ${toolName}`);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  const step = process.locator(".activity-content > details");
  await step.locator("summary").click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.locator("body").evaluate((element) => element.scrollWidth),
  ).toBe(390);
  const row = step.locator(":scope > summary");
  const labelBounds = await trigger.locator(".activity-text").boundingBox();
  const arrowBounds = await trigger.locator(".activity-chevron").boundingBox();
  expect(labelBounds).toBeTruthy();
  expect(arrowBounds).toBeTruthy();
  if (labelBounds && arrowBounds)
    expect(
      Math.abs(
        labelBounds.y +
          labelBounds.height / 2 -
          arrowBounds.y -
          arrowBounds.height / 2,
      ),
    ).toBeLessThanOrEqual(1);
  const rowBounds = await row.boundingBox();
  const statusBounds = await row.locator(".activity-step-status").boundingBox();
  expect(rowBounds).toBeTruthy();
  expect(statusBounds).toBeTruthy();
  expect(
    statusBounds && statusBounds.x + statusBounds.width,
  ).toBeLessThanOrEqual(rowBounds ? rowBounds.x + rowBounds.width + 1 : 0);
  await page.screenshot({ path: "test-results/activity-mobile-live.png" });
  await control("release");
  await expect(trigger).toHaveCount(0);
  const disclosure = process.locator(":scope > details");
  const summary = disclosure.locator(":scope > summary");
  await expect(summary).toHaveText("已完成 1 项操作");
  await expect(disclosure).not.toHaveAttribute("open");
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(1);
  await expect(page.getByLabel("Domos 的回复").locator("strong")).toHaveText(
    "整理完成。",
  );
  await expect(
    page.locator(".conversation-title .character-eye").first(),
  ).toHaveCSS("animation-name", "none");
  await expect(
    page.locator('.bot-avatar svg[data-state="running"]'),
  ).toHaveCount(0);
  await summary.click();
  await step.locator("summary").click();
  await expect(
    step.getByText("已核对完整资料。", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/activity-mobile-complete.png" });
  await page.reload();
  await expect(summary).toHaveText("已完成 1 项操作");
  await expect(disclosure).not.toHaveAttribute("open");
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(1);
});

test("complete progress messages arrive before completion and remain unique after restart", async ({
  page,
}) => {
  await control("gate-tool");
  await control({
    responses: [
      {
        stopReason: "toolUse",
        content: [
          {
            type: "toolCall",
            id: crypto.randomUUID(),
            name: "message_user",
            arguments: { message: "收到，我先核对资料。" },
          },
        ],
      },
      {
        stopReason: "toolUse",
        content: [
          {
            type: "toolCall",
            id: crypto.randomUUID(),
            name: "message_user",
            arguments: { message: "已找到资料，正在整理。" },
          },
        ],
      },
      {
        stopReason: "toolUse",
        content: [
          { type: "text", text: "工具内部说明。" },
          {
            type: "toolCall",
            id: crypto.randomUUID(),
            name: toolName,
            arguments: { text: "已核对。" },
          },
        ],
      },
      { content: "**报告已完成。**" },
    ],
  });
  await page.goto(url);
  await page.getByLabel("消息", { exact: true }).fill("请整理资料");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const replies = page.getByLabel("Domos 的回复", { exact: true });
  await expect(replies).toHaveText([
    "收到，我先核对资料。",
    "已找到资料，正在整理。",
  ]);
  await expect(
    page.getByRole("button", { name: "停止生成", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("log")).not.toContainText("工具内部说明。");
  await page.reload();
  await expect(replies).toHaveText([
    "收到，我先核对资料。",
    "已找到资料，正在整理。",
  ]);
  await expect(
    page.getByRole("button", { name: "Domos 正在工作" }),
  ).toBeVisible();
  await control("release");
  await expect(replies).toHaveText([
    "收到，我先核对资料。",
    "已找到资料，正在整理。",
    "报告已完成。",
  ]);
  await expect(page.locator(".work-status")).toHaveCount(0);
  await expect(
    page.locator(".execution-activity > details > summary"),
  ).toHaveText("已完成 1 项操作");
  const port = Number(new URL(url).port);
  await stop();
  await start(port);
  await page.reload();
  await expect(replies).toHaveText([
    "收到，我先核对资料。",
    "已找到资料，正在整理。",
    "报告已完成。",
  ]);
  await page.screenshot({
    path: "test-results/message-delivery.png",
    fullPage: true,
  });
});

test("Bot identity stays consistent and image previews work in drafts and history", async ({
  page,
}) => {
  await page.goto(url);
  await chooseAppearance(page, "浅色");
  await page.getByRole("button", { name: "新建 Bot", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建 Bot", exact: true });
  const avatar = dialog.locator(".bot-avatar");
  const initial = await avatar.getAttribute("data-seed");
  await dialog.getByRole("button", { name: "换个形象", exact: true }).click();
  await expect(avatar).not.toHaveAttribute("data-seed", initial ?? "");
  const seed = await avatar.getAttribute("data-seed");
  expect(seed).toBeTruthy();
  await dialog.getByLabel("名字", { exact: true }).fill("视觉助手");
  await dialog.getByRole("button", { name: "创建", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const selected = page.locator(
    '.contact-row[aria-current="page"] .bot-avatar',
  );
  await expect(selected).toHaveAttribute("data-seed", seed ?? "");
  await expect(page.locator(".conversation-title .bot-avatar")).toHaveAttribute(
    "data-seed",
    seed ?? "",
  );
  await expect(page.locator(".brand-mark .character-mouth")).toHaveCount(1);
  await expect(page.locator(".bot-avatar .character-mouth")).toHaveCount(0);
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=",
    "base64",
  );
  await page.locator('input[type="file"]').setInputFiles({
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
  await expect(page.getByLabel("视觉助手 的回复")).toHaveCount(1);
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

test("attachment retry keeps its request and draft after a lost receipt", async ({
  page,
}) => {
  await page.goto(url);
  const input = page.getByLabel("消息", { exact: true });
  await expect(
    page.getByRole("button", { name: "添加文件", exact: true }),
  ).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles({
    name: "source.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Source"),
  });
  await expect(
    page.getByRole("button", { name: "移除文件 source.txt", exact: true }),
  ).toBeEnabled();
  await input.fill("处理文件");
  let lost = false;
  await page.route("**/rpc/send", async (route) => {
    if (lost) return route.continue();
    lost = true;
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重试发送", exact: true }),
  ).toBeEnabled();
  await page.reload();
  const retry = page.getByRole("button", { name: "重试发送", exact: true });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("你的消息", { exact: true })).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "下载 source.txt", exact: true }),
  ).toHaveCount(1);
  await expect(page.locator(".composer-attachments")).toHaveCount(0);
});

test("computer details share live directory status and recover a failed refresh", async ({
  page,
}) => {
  await page.goto(url);
  await expect(page.locator(".sidebar-footer")).toContainText("当前电脑");
  const details = await openDetails(page);
  await details.getByRole("button", { name: "电脑", exact: true }).click();
  const computer = details.getByRole("region", {
    name: "工作电脑",
    exact: true,
  });
  await expect(computer).toContainText(/win32|linux|darwin/);
  await expect(computer).toContainText("原生进程");
  await expect(computer).toContainText("工作目录不是安全隔离边界");
  await expect(computer.getByRole("button", { name: "启动电脑" })).toHaveCount(
    0,
  );
  await computer.getByRole("button", { name: "管理电脑" }).click();
  const settings = page.getByRole("complementary", {
    name: "设置",
    exact: true,
  });
  await page.route("**/rpc/computer/list", (route) => route.abort("failed"));
  await settings.getByRole("button", { name: "刷新电脑状态" }).click();
  await expect(settings.getByRole("alert")).toBeVisible();
  await page.unroute("**/rpc/computer/list");
  await settings.getByRole("button", { name: "刷新电脑状态" }).click();
  await expect(settings.getByRole("alert")).toHaveCount(0);
  await settings.getByRole("button", { name: "关闭", exact: true }).click();
  await page.screenshot({ path: "test-results/computer-light.png" });
  await chooseAppearance(page, "深色");
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(
    computer.getByRole("button", { name: "管理电脑" }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/computer-mobile-dark.png" });
  await computer.getByRole("button", { name: "管理电脑" }).focus();
  await page.keyboard.press("Escape");
  await expect(details).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Bot详情", exact: true }),
  ).toBeFocused();
});
