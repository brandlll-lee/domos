import { type ChildProcess, fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

let worker: ChildProcess;
let directory: string;
let url: string;

test.beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "domos-workspace-"));
  worker = fork(
    fileURLToPath(
      new URL("../../api/test/fixtures/web-server.ts", import.meta.url),
    ),
    [join(directory, "data.sqlite"), "0"],
    { silent: true, execArgv: [] },
  );
  worker.stderr?.resume();
  worker.stdout?.resume();
  const [ready] = (await once(worker, "message")) as [{ port: number }];
  url = `http://127.0.0.1:${ready.port}`;
});

test.afterEach(async () => {
  const exited = once(worker, "exit");
  worker.kill("SIGKILL");
  await exited;
  await rm(directory, { recursive: true, force: true });
});

test("panels resize live, persist only on release, and retain drafts across layouts", async ({
  page,
}) => {
  await page.goto(url);
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await input.fill("保留消息草稿");
  const left = page.getByRole("separator", { name: "调整联系人宽度" });
  const before = Number(await left.getAttribute("aria-valuenow"));
  const box = await left.boundingBox();
  if (!box) throw new Error("Resize handle missing");
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + 100, { steps: 8 });
  await expect(left).toHaveAttribute("aria-valuenow", String(before + 40));
  expect(
    await page.evaluate(() => localStorage.getItem("domos:layout:v1")),
  ).toBeNull();
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("domos:layout:v1") ?? "{}").sidebar,
      ),
    )
    .toBe(before + 40);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const name = page.getByRole("textbox", { name: "名字", exact: true });
  await name.fill("尚未保存的名字");
  await page.getByRole("combobox", { name: "Bot设置分区" }).click();
  await page.getByRole("option", { name: "电脑", exact: true }).click();
  await page.getByRole("combobox", { name: "Bot设置分区" }).click();
  await page.getByRole("option", { name: "Bot设置", exact: true }).click();
  await expect(name).toHaveValue("尚未保存的名字");
  const right = page.getByRole("separator", { name: "调整详情宽度" });
  const inspectorPanel = page.locator(
    '.workspace-panel[data-side="inspector"]',
  );
  await expect(inspectorPanel).toHaveCSS("border-inline-start-width", "1px");
  const divider = await page
    .locator(".chat-header")
    .evaluate((element) => getComputedStyle(element).borderBottomColor);
  await expect(inspectorPanel).toHaveCSS("border-inline-start-color", divider);
  await right.focus();
  await right.press("End");
  await expect(right).toHaveAttribute(
    "aria-valuenow",
    (await right.getAttribute("aria-valuemax")) ?? "",
  );
  expect(
    (await page.locator(".conversation").boundingBox())?.width,
  ).toBeGreaterThanOrEqual(392);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(name).toHaveValue("尚未保存的名字");
  const inspector = page.getByRole("dialog", { name: "Bot详情", exact: true });
  await expect(inspector).toHaveAttribute("aria-modal", "true");
  await page.keyboard.press("Escape");
  await expect(input).toHaveValue("保留消息草稿");
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await expect(name).toHaveValue("尚未保存的名字");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.reload();
  await expect(left).toHaveAttribute("aria-valuenow", String(before + 40));
  await expect(input).toHaveValue("保留消息草稿");
});

test("settings stay readable in both themes and compact layouts", async ({
  page,
}, testInfo) => {
  await page.goto(url);
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await input.fill("返回后继续编辑");
  const trigger = page.getByRole("button", { name: "设置", exact: true });
  await trigger.click();
  const settings = page.getByRole("main", { name: "设置", exact: true });
  await expect(page.locator(".app-titlebar")).toHaveCount(1);
  await expect(page.locator(".app-titlebar")).toBeVisible();
  await expect(input).toBeHidden();
  await expect(
    page.getByRole("dialog", { name: "设置", exact: true }),
  ).toHaveCount(0);
  expect((await settings.boundingBox())?.y).toBe(48);
  expect((await settings.boundingBox())?.width).toBeGreaterThan(800);
  for (const [theme, label] of [
    ["dark", "深色"],
    ["light", "浅色"],
  ]) {
    await page.getByRole("combobox", { name: "外观", exact: true }).click();
    await page.getByRole("option", { name: label, exact: true }).click();
    await page.evaluate(() => document.fonts.ready);
    if (process.platform === "win32")
      await expect(settings).toHaveScreenshot(`settings-${theme}.png`);
    await page.screenshot({
      path: testInfo.outputPath(`settings-${theme}.png`),
    });
  }
  const search = settings.getByRole("searchbox", { name: "搜索设置" });
  await search.fill("主题");
  await expect(
    settings.getByRole("tab", { name: "通用", exact: true }),
  ).toBeVisible();
  await expect(
    settings.getByRole("tab", { name: "电脑高级管理", exact: true }),
  ).toHaveCount(0);
  await search.fill("不存在的设置");
  await expect(settings.getByRole("status")).toHaveText("没有匹配的设置");
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(settings).toBeVisible();
  await search.fill("访问");
  await search.press("Enter");
  await expect(
    settings.getByRole("tab", { name: "通用", exact: true }),
  ).toBeFocused();
  await expect(search).toHaveValue("");
  await settings
    .getByRole("group", { name: "电脑高级管理", exact: true })
    .getByRole("button", { name: "打开", exact: true })
    .click();
  await settings
    .getByRole("button", { name: "添加 Docker 电脑", exact: true })
    .click();
  const add = page.getByRole("dialog", {
    name: "添加 Docker 电脑",
    exact: true,
  });
  let additions = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/rpc/computer/add")) additions++;
  });
  await add.getByLabel("电脑名称", { exact: true }).fill("尚未添加");
  await add.getByRole("button", { name: "取消", exact: true }).click();
  await settings.getByRole("tab", { name: "通用", exact: true }).click();
  await settings
    .getByRole("group", { name: "电脑高级管理", exact: true })
    .getByRole("button", { name: "打开", exact: true })
    .click();
  await settings
    .getByRole("button", { name: "添加 Docker 电脑", exact: true })
    .click();
  await expect(add.getByLabel("电脑名称", { exact: true })).toHaveValue(
    "尚未添加",
  );
  await page.keyboard.press("Escape");
  await expect(settings).toBeVisible();
  expect(additions).toBe(0);
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(
      settings.getByRole("tab", { name: "模型", exact: true }),
    ).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`settings-${width}.png`),
    });
  }
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "设置", exact: true }),
  ).toBeFocused();
  await expect(input).toHaveValue("返回后继续编辑");
});

test("empty chats retain their creation time and compact controls across layouts", async ({
  page,
}) => {
  await page.goto(url);
  const time = page.locator(".conversation-time");
  await expect(time).toBeVisible();
  const createdAt = await time.getAttribute("datetime");
  expect(Date.parse(createdAt ?? "")).toBeLessThanOrEqual(Date.now());
  await expect(page.locator(".transcript .bot-avatar")).toHaveCount(0);
  const header = await page.locator(".chat-header").boundingBox();
  expect((await time.boundingBox())?.y).toBeGreaterThan(
    (header?.y ?? 0) + (header?.height ?? 0),
  );
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  const composer = page.locator(".message-composer");
  expect((await composer.boundingBox())?.height).toBeLessThanOrEqual(48);
  const border = await composer.evaluate(
    (item) => getComputedStyle(item).borderColor,
  );
  await input.click();
  await expect(composer).toHaveCSS("border-color", border);
  await expect(input).toHaveCSS("outline-style", "none");
  await expect(page.getByRole("searchbox")).toHaveAttribute(
    "placeholder",
    "搜索",
  );
  await page.reload();
  await expect(time).toHaveAttribute("datetime", createdAt ?? "");
  await page.getByRole("button", { name: "Bot电脑", exact: true }).click();
  const details = page.getByRole("complementary", { name: "Domos的详情" });
  await expect(
    details.getByRole("group", { name: "服务所在电脑" }),
  ).toBeVisible();
  await details
    .getByRole("button", { name: "更换工作环境", exact: true })
    .click();
  const environment = page.getByRole("dialog", {
    name: "Bot 在哪里工作？",
    exact: true,
  });
  await expect(
    environment.getByRole("group", { name: "此 Bot 的工作环境" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(environment).toBeHidden();
  await page.getByRole("button", { name: "Bot设置", exact: true }).click();
  await expect(
    details.getByRole("textbox", { name: "名字", exact: true }),
  ).toBeVisible();
  await details.getByRole("button", { name: "关闭", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "联系人", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("main", { name: "设置", exact: true });
  await settings.getByRole("button", { name: "返回对话", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "联系人", exact: true }),
  ).toBeFocused();
  await expect(input).toBeVisible();
});

test("contact rows keep their density and searchable previews across selections", async ({
  page,
}) => {
  await page.goto(url);
  await page.getByRole("button", { name: "新建 Bot", exact: true }).click();
  let create = page.getByRole("dialog", { name: "新建 Bot", exact: true });
  await create
    .getByRole("textbox", { name: "名字", exact: true })
    .fill("研究助手");
  await create
    .getByRole("textbox", { name: "职责与指令", exact: true })
    .fill("整理研究资料");
  await create.getByRole("button", { name: "创建", exact: true }).click();
  await create.getByRole("button", { name: "授权并继续", exact: true }).click();
  await expect(create).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Bot详情", exact: true }),
  ).toContainText("研究助手");
  await page.getByRole("button", { name: "新建 Bot", exact: true }).click();
  create = page.getByRole("dialog", { name: "新建 Bot", exact: true });
  const longName = "负责跨语言内容审校与排版的 Editorial Assistant";
  await create
    .getByRole("textbox", { name: "名字", exact: true })
    .fill(longName);
  await create.getByRole("button", { name: "创建", exact: true }).click();
  await create.getByRole("button", { name: "授权并继续", exact: true }).click();
  await expect(create).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Bot详情", exact: true }),
  ).toContainText(longName);
  const contacts = page.getByRole("navigation", {
    name: "联系人",
    exact: true,
  });
  await expect(contacts.getByRole("link")).toHaveCount(3);
  const rows = page.locator(".contact-row");
  const geometry = await rows.evaluateAll((items) =>
    items.map((item) => ({
      height: item.getBoundingClientRect().height,
      lines: item.querySelectorAll(".chat-preview > *").length,
      nameWeight: getComputedStyle(item.querySelector("strong") as HTMLElement)
        .fontWeight,
    })),
  );
  expect(
    geometry.every(
      (item) => item.height === geometry[0]?.height && item.lines === 2,
    ),
  ).toBe(true);
  expect(geometry[0]?.height).toBe(54);
  expect(geometry[0]?.nameWeight).toBe("500");
  const search = page.getByRole("searchbox", { name: "搜索联系人" });
  await search.fill("开始对话");
  await expect(contacts.getByRole("link")).toHaveCount(2);
  await search.fill("整理研究资料");
  await expect(
    contacts.getByRole("link", { name: "研究助手", exact: true }),
  ).toBeVisible();
  await search.clear();
  const root = contacts.getByRole("link", { name: "Domos", exact: true });
  await root.click();
  await expect(
    page.getByRole("button", { name: "Bot详情", exact: true }),
  ).toContainText("Domos");
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill("核对列表预览");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(root).toContainText("已收到：核对列表预览");
  await contacts.getByRole("link", { name: "研究助手", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Bot详情", exact: true }),
  ).toContainText("研究助手");
  await search.fill("已收到：核对列表预览");
  await expect(root).toBeVisible();
  await search.clear();
  const active = contacts.getByRole("link", { name: "研究助手", exact: true });
  const selectedColor = await active.evaluate(
    (item) => getComputedStyle(item).backgroundColor,
  );
  await root.hover();
  expect(
    await root.evaluate((item) => getComputedStyle(item).backgroundColor),
  ).not.toBe(selectedColor);
  await page.reload();
  await expect(root).toContainText("已收到：核对列表预览");
});

test("control geometry and interaction states stay consistent", async ({
  page,
}) => {
  await page.goto(url);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const details = page.getByRole("complementary", { name: "Domos的详情" });
  const picker = details.getByRole("combobox", { name: "Bot设置分区" });
  const inset = await picker.evaluate((item) => {
    const box = item.getBoundingClientRect();
    const value = item.querySelector(".picker-value")?.getBoundingClientRect();
    const header = item.parentElement?.getBoundingClientRect();
    return {
      left: (value?.left ?? 0) - box.left,
      top: box.top - (header?.top ?? 0),
      bottom: (header?.bottom ?? 0) - box.bottom,
    };
  });
  expect(inset.left).toBeGreaterThanOrEqual(8);
  expect(inset.top).toBeGreaterThanOrEqual(8);
  expect(inset.bottom).toBeGreaterThanOrEqual(8);
  const name = details.getByRole("textbox", { name: "名字", exact: true });
  const model = details.getByRole("combobox", { name: "模型", exact: true });
  const inputHeight = (await name.boundingBox())?.height;
  expect(inputHeight).toBe(40);
  expect((await model.boundingBox())?.height).toBe(32);
  await expect(details.locator(".detail-header")).toHaveCSS(
    "border-bottom-width",
    "0px",
  );
  const save = details.getByRole("button", { name: "保存身份", exact: true });
  await expect(save).toHaveCount(0);
  await name.fill("编辑中的名字");
  await expect(save).toBeEnabled();
  await details.getByRole("button", { name: "还原", exact: true }).click();
  await expect(name).toHaveValue("Domos");
  await expect(save).toHaveCount(0);
  await name.fill("");
  await expect(save).toBeDisabled();
  const color = await save.evaluate(
    (item) => getComputedStyle(item).backgroundColor,
  );
  await save.hover();
  await expect(save).toHaveCSS("background-color", color);
  await details.getByRole("button", { name: "还原", exact: true }).click();
  await picker.click();
  await page.getByRole("option", { name: "电脑", exact: true }).click();
  await details.getByRole("button", { name: "高级选项", exact: true }).click();
  const select = details.getByRole("combobox", {
    name: "连接已有电脑",
    exact: true,
  });
  expect((await select.boundingBox())?.height).toBe(inputHeight);
  await expect(select).toHaveCSS("font-size", "14px");
  await picker.click();
  await page.getByRole("option", { name: "记忆", exact: true }).click();
  const checkbox = details.getByRole("checkbox", { name: "共享给所有Bot" });
  await expect(checkbox).toHaveCSS("width", "16px");
  await expect(checkbox).toHaveCSS("margin", "0px");
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await details.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("main", { name: "设置", exact: true });
  const nav = settings.getByRole("tablist", { name: "设置分区" });
  await expect(nav).toHaveAttribute("aria-orientation", "vertical");
  const appearance = settings.getByRole("tab", { name: "通用", exact: true });
  const computer = settings.getByRole("tab", { name: "模型", exact: true });
  const active = await appearance.evaluate(
    (item) => getComputedStyle(item).backgroundColor,
  );
  await computer.hover();
  expect(
    await computer.evaluate((item) => getComputedStyle(item).backgroundColor),
  ).not.toBe(active);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(nav).toHaveAttribute("data-orientation", "horizontal");
  await appearance.focus();
  await appearance.press("ArrowRight");
  await expect(
    settings.getByRole("tab", { name: "模型", exact: true }),
  ).toBeFocused();
});

test("resizing tolerates blocked preferences and pointer cancellation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new DOMException("Blocked", "SecurityError");
    };
    Storage.prototype.setItem = () => {
      throw new DOMException("Blocked", "SecurityError");
    };
  });
  await page.goto(url);
  const handle = page.getByRole("separator", { name: "调整联系人宽度" });
  await handle.press("Home");
  const min = await handle.getAttribute("aria-valuemin");
  await expect(handle).toHaveAttribute("aria-valuenow", min ?? "");
  const box = await handle.boundingBox();
  if (!box) throw new Error("Resize handle missing");
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + 100);
  await handle.dispatchEvent("pointercancel");
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", min ?? "");
  await handle.press("ArrowRight");
  expect(Number(await handle.getAttribute("aria-valuenow"))).toBeGreaterThan(
    Number(min),
  );
});
