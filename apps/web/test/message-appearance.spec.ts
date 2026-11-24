import { once } from "node:events";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { userBubbleColors } from "@domos/ui/bubble-colors";
import { characterColors, characterSeed } from "@domos/ui/characters";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { expect } from "@playwright/test";
import type { client as appClient } from "../src/client.ts";
import {
  attachFiles,
  chooseAppearance,
  chooseDetail,
  expectTextContrast,
  openDetails,
  openSettings,
} from "./fixtures/chat-ui.ts";
import { test } from "./fixtures/service.ts";

test("shared overlays finish their exit, retain content and restore keyboard focus", async ({
  service,
  page,
}) => {
  await page.goto(service.url);
  const menuTrigger = page.getByRole("button", {
    name: "用户菜单",
    exact: true,
  });
  const menu = page.locator(".action-menu");
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await menuTrigger.click();
    await expect(menu).toBeVisible();
    await menu.evaluate((node) =>
      Promise.allSettled(
        node.getAnimations().map((animation) => animation.finished),
      ),
    );
    await page.keyboard.press("Escape");
    await expect(menu).toHaveAttribute("data-ending-style");
    await expect(menu).toContainText("设置");
    await expect(menu).toHaveCSS("interactivity", "inert");
    await page.keyboard.press("Tab");
    expect(
      await menu.evaluate((node) => node.contains(document.activeElement)),
    ).toBe(false);
    await expect(menu).toHaveCount(0);

    await menuTrigger.click();
    await page.getByRole("menuitem", { name: "设置", exact: true }).click();
    const settings = page.locator(".settings-window");
    await expect(settings.locator(".settings-page")).toBeVisible();
    await settings.evaluate((node) =>
      Promise.allSettled(
        node.getAnimations().map((animation) => animation.finished),
      ),
    );
    await page.keyboard.press("Escape");
    await expect(settings).toHaveAttribute("data-ending-style");
    await expect(settings.locator(".settings-page")).toContainText("通用");
    await expect(settings).toHaveCSS("interactivity", "inert");
    await expect(settings).toHaveCount(0);
    await expect(menuTrigger).toBeFocused();

    await page.getByRole("button", { name: "Bot详情", exact: true }).click();
    const context = page.getByRole("button", {
      name: "上下文窗口",
      exact: true,
    });
    if (!(await context.isVisible()))
      await page.getByRole("button", { name: "Bot详情", exact: true }).click();
    await context.click();
    const popup = page.locator(".popover-surface");
    await expect(popup).toBeVisible();
    await popup.evaluate((node) =>
      Promise.allSettled(
        node.getAnimations().map((animation) => animation.finished),
      ),
    );
    await page.keyboard.press("Escape");
    await expect(popup).toHaveAttribute("data-ending-style");
    await expect(popup).toHaveCSS("interactivity", "inert");
    await expect(popup).toHaveCount(0);
    await expect(context).toBeFocused();
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await menuTrigger.click();
  await expect(menu).toHaveCSS("transition-duration", "0s");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});

test("text contrast, keyboard focus and message scrolling meet the UI contract", async ({
  service,
  page,
}) => {
  await page.goto(service.url);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  await expectTextContrast(page);
  const details = await openDetails(page);
  await chooseDetail(details, "运行");
  const picker = page.getByRole("combobox", { name: "模型", exact: true });
  const restingBorder = await page
    .locator(".message-composer")
    .evaluate((element) => getComputedStyle(element).borderColor);
  await picker.focus();
  await page.keyboard.press("Tab");
  await expect(
    details.getByRole("button", { name: "上下文窗口", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    details.getByRole("combobox", { name: "操作审批", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    details.getByRole("button", { name: /^模型与账号/ }),
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: "添加内容", exact: true }),
  ).toBeEnabled();
  await details.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(details).toBeHidden();
  await page.getByRole("button", { name: "添加内容", exact: true }).focus();
  await expect(
    page.getByRole("button", { name: "添加内容", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  const input = page.getByLabel("消息", { exact: true });
  await expect(input).toBeFocused();
  await expect(input).toHaveCSS("outline-style", "none");
  await expect
    .poll(() =>
      page
        .locator(".message-composer")
        .evaluate((element) => getComputedStyle(element).borderColor),
    )
    .toBe(restingBorder);
  await input.fill("长消息\n".repeat(80));
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  await page
    .getByLabel("你的消息")
    .getByRole("button", { name: "展开", exact: true })
    .click();
  await expect
    .poll(() =>
      page
        .locator(".transcript")
        .evaluate((element) => element.scrollHeight > element.clientHeight),
    )
    .toBe(true);
  await page.locator(".transcript").hover();
  await page.mouse.wheel(0, -10000);
  await expect(page.getByRole("button", { name: "返回最新" })).toBeVisible();
  await page.getByRole("button", { name: "停止生成" }).click();
  await page.getByRole("button", { name: "返回最新" }).click();
  await expect(page.getByRole("button", { name: "返回最新" })).toHaveCount(0);
});

test("appearance follows the system, persists, and syncs between tabs", async ({
  service,
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(service.url);
  const root = page.locator("html");
  await openSettings(page);
  const appearance = page.getByRole("combobox", { name: "外观" });
  await expect(appearance).toContainText("跟随系统");
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(root).toHaveAttribute("data-theme", "dark");
  await chooseAppearance(page, "浅色");
  await page.reload();
  await openSettings(page);
  await expect(appearance).toContainText("浅色");
  await expect(root).toHaveAttribute("data-theme", "light");
  const other = await context.newPage();
  await other.goto(service.url);
  await openSettings(other);
  await expect(other.getByRole("combobox", { name: "外观" })).toContainText(
    "浅色",
  );
  await chooseAppearance(page, "深色");
  await expect(other.locator("html")).toHaveAttribute("data-theme", "dark");
  await other.close();
});

test("appearance remains usable when storage is blocked", async ({
  service,
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
  await page.goto(service.url);
  await openSettings(page);
  await chooseAppearance(page, "浅色");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(
    page.getByRole("alert").filter({ hasText: "外观已应用" }),
  ).toBeVisible();
});

test("structured messages keep Markdown and private tool results across reloads", async ({
  service,
  page,
}) => {
  const markdown =
    "## 调研结果\n\n**重点**与[官方资料](https://example.com)。\n\n| 项目 | 状态 |\n| --- | --- |\n| 调研 | 完成 |\n\n```ts\nconst ready = true;\n```\n\n<script>window.injected = true</script>\n\n[危险链接](javascript:alert(1))";
  await service.control({
    content: [
      {
        type: "thinking",
        thinking: "核对已有资料。",
        thinkingSignature: "private-signature",
      },
      { type: "text", text: markdown },
    ],
  });
  await page.goto(service.url);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  await page.getByLabel("消息", { exact: true }).fill("检查排版");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const response = page.getByLabel("Domos 的回复");
  await expect(response.locator("strong")).toHaveText("重点");
  await expect(response.getByRole("table")).toBeVisible();
  await expect(response.locator("pre code")).toHaveText("const ready = true;");
  await expect(
    page.getByRole("button", { name: "语音输入（暂未开放）", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("核对已有资料。", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    response.getByRole("link", { name: "官方资料" }),
  ).toHaveAttribute("href", "https://example.com");
  await expect(response.locator("script")).toHaveCount(0);
  await expect(
    response.getByRole("link", { name: "危险链接" }),
  ).not.toHaveAttribute("href", /^javascript:/);
  await expect(
    page.getByRole("button", { name: "语音输入（暂未开放）", exact: true }),
  ).toBeVisible();
  await service.control("gate-tool");
  const callId = crypto.randomUUID();
  await service.control({
    stopReason: "toolUse",
    content: [
      {
        type: "toolCall",
        id: callId,
        name: service.toolName,
        arguments: { text: "**工具结果**", fail: true },
      },
    ],
  });
  await page.getByLabel("消息", { exact: true }).fill("调用工具");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".typing-dots")).toBeVisible();
  await service.control("release");
  await expect(
    page.getByRole("button", { name: "语音输入（暂未开放）", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".task-notice")).toHaveCount(0);
  await expect(
    page.getByRole("log").getByText("工具结果", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: "test-results/workspace-content.png" });
  await page.reload();
  await expect(page.locator(".task-notice")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "调研结果" })).toBeVisible();
});

test("Markdown retains its reading hierarchy across themes and text enlargement", async ({
  service,
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
  await service.control({ content: markdown });
  await page.goto(service.url);
  const input = page.getByLabel("消息", { exact: true });
  await expect(input).toBeEnabled();
  await input.fill("请保留全部内容格式。");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const reply = page.getByLabel("Domos 的回复");
  await expect(reply.getByRole("heading")).toHaveCount(6);
  const expectScale = async (scale: number) => {
    const values = await reply.evaluate((element) =>
      [
        ...element.querySelectorAll(
          "h1,h2,h3,h4,h5,h6,p,li,blockquote,th,td,code",
        ),
      ].map((node) => ({
        tag: node.tagName.toLowerCase(),
        size: Number.parseFloat(getComputedStyle(node).fontSize),
        line: Number.parseFloat(getComputedStyle(node).lineHeight),
      })),
    );
    for (const { tag, size, line } of values) {
      const [expectedSize, expectedLine] =
        tag === "h1"
          ? [20, 28]
          : tag === "h2"
            ? [17, 24]
            : tag === "h3"
              ? [15, 22]
              : [14, 22];
      expect(size).toBe(expectedSize * scale);
      expect(line).toBe(expectedLine * scale);
    }
    for (const node of await reply.locator("h1,h2,h3,h4,h5,h6,strong,th").all())
      await expect(node).toHaveCSS("font-weight", "600");
    await expect(reply.locator("h1")).toHaveCSS("margin-top", "0px");
    await expect(reply.locator("h2")).toHaveCSS(
      "margin-top",
      `${18 * scale}px`,
    );
    await expect(reply.locator("h2")).toHaveCSS(
      "margin-bottom",
      `${8 * scale}px`,
    );
    await expect(reply.locator(".markdown > p")).toHaveCSS(
      "margin-top",
      `${10 * scale}px`,
    );
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
  for (const width of [1600, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [theme, label] of [
      ["light", "浅色"],
      ["dark", "深色"],
    ] as const) {
      await chooseAppearance(page, label);
      await expectScale(1);
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
  await expectScale(2);
  await expect(input).toBeVisible();
  await input.fill("放大后仍可编辑。");
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeEnabled();
});

test("Markdown tables retain readable columns and quotes retain body contrast", async ({
  service,
  page,
}, info) => {
  await service.control({
    content: [
      "**结论：优先验证实际业务。**",
      "继续核对工具调用、记忆和执行记录。",
      "| 项目 | 经验 | 证据 | 下一步 |\n| --- | --- | --- | --- |\n| 商家智能客服与订单异常检测 | 两年客户服务产品开发经验 | 原生工具调用和执行记录 | 补充生产使用评估与成本数据 |",
      "> 引用内容保持清晰可读。",
    ].join("\n\n"),
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(service.url);
  await page.getByLabel("消息", { exact: true }).fill("检查中文表格和引用。");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const reply = page.getByLabel("Domos 的回复");
  await expect(reply.getByRole("table")).toBeVisible();
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    const table = reply.getByRole("table");
    for (const cell of await table.getByRole("cell").all())
      expect((await cell.boundingBox())?.width).toBeGreaterThanOrEqual(128);
    const scroll = reply.locator(".markdown-table");
    expect(
      await scroll.evaluate((node) => node.scrollWidth > node.clientWidth),
    ).toBe(true);
    await expect(scroll).toHaveCSS("overflow-x", "auto");
    const header = table.getByRole("columnheader").first();
    await expect(header).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const quote = reply.locator("blockquote");
    await expect(quote).toHaveCSS(
      "color",
      await reply
        .locator(".markdown")
        .evaluate((node) => getComputedStyle(node).color),
    );
    await expect(quote).toHaveCSS("border-inline-start-width", "2px");
    await expect(reply.getByRole("heading")).toHaveCount(0);
    await expect(reply.locator("strong")).toHaveCSS("font-weight", "600");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await scroll.evaluate((node) => {
      node.scrollLeft = node.scrollWidth;
    });
    expect(await scroll.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
    await page.screenshot({
      path: info.outputPath(`markdown-table-${theme}.png`),
    });
  }
});

test("bundled Chinese and Latin faces render shared text weights", async ({
  service,
  page,
}) => {
  await service.control({ content: "中文消息与 Latin 文字。**重点内容**" });
  await page.goto(service.url);
  await page.getByLabel("消息", { exact: true }).fill("检查字体");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const paragraph = page.getByLabel("Domos 的回复").locator("p");
  await expect(paragraph).toContainText("中文消息与 Latin 文字。");
  await page.evaluate(() => document.fonts.ready);
  await expect(paragraph).toHaveCSS("font-weight", "400");
  await expect(paragraph.locator("strong")).toHaveCSS("font-weight", "600");
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
  service,
  page,
}) => {
  await page.route("**/*noto-sans-sc*.woff2", (route) => route.abort());
  await service.control({ content: "字体回退后，中文与 Latin 仍然可读。" });
  await page.goto(service.url);
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

test("IM bubbles, search dialog, and popup surfaces share both themes", async ({
  service,
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await service.control({
    content:
      "**已整理好。**\n\n- 核对参考源码\n- 统一交互与主题\n- 验证窄屏和键盘\n\n```ts\nconst result = { status: 'complete', message: '内容在气泡内展示' };\n```\n\n接下来可以直接继续对话。",
  });
  await page.goto(service.url);
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
  expect(received.x + received.width).toBeLessThanOrEqual(
    column.x + column.width,
  );
  expect(received.width).toBeLessThanOrEqual(720);
  expect(sent.x + sent.width).toBeCloseTo(column.x + column.width, 0);
  const searchButton = page.getByRole("button", {
    name: "搜索联系人和聊天记录",
    exact: true,
  });
  await searchButton.click();
  const search = page.getByRole("searchbox", { name: "搜索联系人和聊天记录" });
  await search.fill(crypto.randomUUID());
  await expect(page.getByText("没有找到联系人", { exact: true })).toBeVisible();
  await search.fill("统一交互");
  await expect(
    page
      .getByRole("dialog", { name: "搜索", exact: true })
      .locator(".search-hit")
      .first(),
  ).toBeVisible();
  await search.clear();
  await page.keyboard.press("Escape");
  await expect(searchButton).toBeFocused();
  for (const [theme, label] of [
    ["light", "浅色"],
    ["dark", "深色"],
  ] as const) {
    await chooseAppearance(page, label);
    await expectTextContrast(page);
    await expect(page.locator(".settings-window")).toHaveCount(0);
    await searchButton.click();
    await expect(search).toHaveCSS("outline-style", "none");
    await expect(page.locator(".chat-search-dialog .command-search")).toHaveCSS(
      "box-shadow",
      "none",
    );
    await page.keyboard.press("Escape");
    await expect(searchButton).toBeFocused();
    await expect(outgoing).toHaveCSS(
      "color",
      theme === "light" ? "rgb(255, 255, 255)" : "rgb(245, 245, 245)",
    );
    await page.screenshot({ path: `test-results/im-${theme}.png` });
    const details = await openDetails(page);
    await chooseDetail(details, "运行");
    await page.getByRole("combobox", { name: "模型", exact: true }).click();
    await expect(page.getByRole("option").first()).toBeVisible();
    await page
      .locator(".model-selector-popup")
      .evaluate((element) =>
        Promise.all(
          element.getAnimations().map((animation) => animation.finished),
        ),
      );
    await expectTextContrast(page);
    await page.screenshot({ path: `test-results/im-model-${theme}.png` });
    await page.keyboard.press("Escape");
    const settings = await openSettings(page);
    await page.getByRole("combobox", { name: "外观", exact: true }).click();
    await expect(
      page.getByRole("option", { name: label, exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: `test-results/im-appearance-${theme}.png` });
    await page.keyboard.press("Escape");
    await settings
      .getByRole("button", { name: "返回对话", exact: true })
      .click();
    await details.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(details).not.toBeVisible();
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
  service,
  page,
}) => {
  test.setTimeout(60_000);
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1360, height: 700 });
  await page.goto(service.url);
  const input = page.getByLabel("消息", { exact: true });
  const send = page.getByRole("button", { name: "发送", exact: true });
  await expect(
    page.getByRole("button", { name: "语音输入（暂未开放）", exact: true }),
  ).toBeDisabled();
  for (let turn = 0; turn < 2; turn++) {
    await service.control({
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
    await expect(
      page.getByRole("button", { name: "语音输入（暂未开放）", exact: true }),
    ).toBeVisible();
  }
  const last = page.getByLabel("Domos 的回复").last();
  const expectLatest = async () => {
    await expect
      .poll(async () => ({
        visible: await last.evaluate((element) => {
          const dock = document.querySelector(".composer-area");
          if (!dock) throw new Error("Missing composer dock");
          return (
            element.getBoundingClientRect().bottom <=
            dock.getBoundingClientRect().top
          );
        }),
        errors,
      }))
      .toEqual({ visible: true, errors: [] });
    await expect(page.getByRole("button", { name: "返回最新" })).toHaveCount(0);
  };
  await expectLatest();
  await input.fill(
    Array.from({ length: 12 }, (_, index) => `草稿第 ${index + 1} 行`).join(
      "\n",
    ),
  );
  await expectLatest();
  await page
    .locator("#bot-details")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 700 });
  await expectLatest();
  await input.fill("");
  await attachFiles(page, {
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
  const latestBounds = await latest.boundingBox();
  const composerBounds = await page.locator(".composer-area").boundingBox();
  expect(
    latestBounds &&
      composerBounds &&
      latestBounds.y + latestBounds.height < composerBounds.y + 1,
  ).toBe(true);
  expect(latestBounds && latestBounds.x > 300).toBe(true);
  await expect(latest).toHaveCSS("border-radius", "999px");
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
  expect(errors).toEqual([]);
});

test("composer fades scrolling messages and covers content below its edge", async ({
  service,
  page,
}) => {
  const media = await page.context().newCDPSession(page);
  await media.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-reduced-transparency", value: "no-preference" },
    ],
  });
  await service.control({
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
  await page.goto(service.url);
  await page.getByLabel("消息", { exact: true }).fill("查看记录");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByLabel("Domos 的回复").getByRole("link")).toHaveCount(
    30,
  );
  await page
    .getByLabel("Domos 的回复")
    .getByRole("button", { name: "展开", exact: true })
    .click();
  for (const width of [1360, 390]) {
    await page.setViewportSize({ width, height: 700 });
    for (const label of ["浅色", "深色"]) {
      await chooseAppearance(page, label);
      await expect
        .poll(() =>
          page.locator(".transcript").evaluate((element) => {
            const dock = document.querySelector(".composer-area");
            if (!dock) throw new Error("Missing composer dock");
            return (
              Number.parseFloat(getComputedStyle(element).paddingBottom) -
              dock.getBoundingClientRect().height
            );
          }),
        )
        .toBeGreaterThan(0);
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
      const conversation = await page.locator(".conversation").boundingBox();
      expect(pane && Math.round(pane.y + pane.height)).toBe(
        conversation && Math.round(conversation.y + conversation.height),
      );
      await page.screenshot({
        path: `test-results/floating-composer-${width}-${label}.png`,
      });
    }
  }
});

test("message links inherit text and highlight on interaction without a background", async ({
  service,
  page,
}, info) => {
  test.setTimeout(60000);
  // Playwright aborts favicon routes before page interceptors.
  const cdp = await page.context().newCDPSession(page);
  const icon = (await readFile("packages/ui/assets/favicon.png")).toString(
    "base64",
  );
  cdp.on("Fetch.requestPaused", ({ requestId, request }) => {
    void cdp.send("Fetch.fulfillRequest", {
      requestId,
      responseCode: request.url.startsWith("https://example.com/") ? 200 : 404,
      responseHeaders: [{ name: "Content-Type", value: "image/png" }],
      body: request.url.startsWith("https://example.com/") ? icon : "",
    });
  });
  await cdp.send("Fetch.enable", {
    patterns: [{ urlPattern: "https://*/favicon.ico" }],
  });
  await page.goto(service.url);
  await expect(
    page.getByRole("button", { name: "Bot详情", exact: true }),
  ).toBeVisible();
  const closeDetails = page
    .locator("#bot-details")
    .getByRole("button", { name: "关闭", exact: true });
  if (await closeDetails.isVisible()) await closeDetails.click();
  const botColor = await page
    .locator(".conversation")
    .evaluate((node) => node.style.getPropertyValue("--bot-color"));
  const receipt = once(service.worker, "message");
  service.worker.send({
    content:
      "查看 [网站来源](https://example.com/article)，以及 [另一来源](https://missing.example/article)。",
  });
  await receipt;
  const text = `**保持原文**\n  请看 https://example.com/${"long-path-".repeat(18)}?q=1&x=2, 谢谢。`;
  await page.getByRole("textbox", { name: "消息", exact: true }).fill(text);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const user = page.getByLabel("你的消息").locator(".user-text");
  await expect(user).toHaveText(text);
  const source = page.getByRole("link", { name: "网站来源", exact: true });
  await expect(source).toBeVisible();
  await expect(source.locator("img")).toBeVisible();
  const missing = page.getByRole("link", { name: "另一来源", exact: true });
  await expect(missing.locator("img")).toBeHidden();
  await expect(missing.locator(".message-link-icon > span")).toBeVisible();
  await source.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(source).toBeFocused();
  await expect(source).toHaveCSS("outline-style", "solid");
  const colors: string[] = [];
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    const normal = await source
      .locator("..")
      .evaluate((node) => getComputedStyle(node).color);
    for (const { color } of [
      ...characterColors,
      ...["#000000", "#ffffff", "#808080", "#ffffaa", "#123456"].map(
        (color) => ({ color }),
      ),
    ]) {
      await page
        .locator(".conversation")
        .evaluate(
          (node, color) => node.style.setProperty("--bot-color", color),
          color,
        );
      await page.mouse.move(1, 1);
      await source.evaluate((node) => node.blur());
      await expect(source).toHaveCSS("color", normal);
      await expect(source).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await source.hover();
      await expect(source).toHaveCSS(
        "color",
        `rgb(${color
          .slice(1)
          .match(/../g)
          ?.map((part) => Number.parseInt(part, 16))
          .join(", ")})`,
      );
      await expect(source).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    }
    await page
      .locator(".conversation")
      .evaluate(
        (node, color) => node.style.setProperty("--bot-color", color),
        botColor,
      );
    colors.push(normal);
    await source.hover();
    await expect(source).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    for (const width of [1360, 390]) {
      await page.setViewportSize({ width, height: 900 });
      if (width === 390)
        await expect(page.locator(".workspace")).toHaveAttribute(
          "data-mobile",
          "true",
        );
      if (width === 390) await page.keyboard.press("Escape");
      await page.evaluate(() => document.activeViewTransition?.finished);
      await expect(user).toBeVisible();
      await expect
        .poll(() =>
          user.evaluate((node) => node.scrollWidth <= node.clientWidth),
        )
        .toBe(true);
      await page.screenshot({
        path: info.outputPath(`links-${theme}-${width}.png`),
        animations: "disabled",
      });
    }
    await page.setViewportSize({ width: 1360, height: 900 });
  }
  expect(colors[0]).not.toBe(colors[1]);
});

test("long bubbles fold with a fade and retain full text without outgoing timestamps", async ({
  service,
  page,
}) => {
  const receipt = once(service.worker, "message");
  service.worker.send({ content: "核对结果。\n\n".repeat(28) });
  await receipt;
  await page.goto(service.url);
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill("用户长内容\n".repeat(60));
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const outgoing = page.getByLabel("你的消息").last();
  await expect(
    outgoing.getByRole("button", { name: "展开", exact: true }),
  ).toBeVisible();
  const body = outgoing.locator(".message-body");
  expect((await body.boundingBox())?.height).toBeCloseTo(384, 1);
  await expect(outgoing.locator("time")).toHaveCount(0);
  await outgoing.getByRole("button", { name: "展开", exact: true }).click();
  expect((await body.boundingBox())?.height).toBeGreaterThan(384);
  await outgoing.getByRole("button", { name: "收起", exact: true }).click();
  const incoming = page.getByLabel("Domos 的回复").last();
  await expect(
    incoming.getByRole("button", { name: "展开", exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  const incomingBody = incoming.locator(".message-body");
  await expect(incoming.locator(".markdown p")).toHaveCount(28);
  expect((await incomingBody.boundingBox())?.height).toBeCloseTo(384, 1);
  const gap = await incoming.evaluate(
    (node) =>
      node.getBoundingClientRect().top -
      (node.previousElementSibling?.getBoundingClientRect().bottom ?? 0),
  );
  expect(gap).toBeGreaterThanOrEqual(12);
  await incoming.getByRole("button", { name: "展开", exact: true }).click();
  expect((await incomingBody.boundingBox())?.height).toBeGreaterThan(384);
  const close = page.locator("#bot-details").getByRole("button", {
    name: "关闭",
    exact: true,
  });
  if (await close.isVisible()) await close.click();
  await page.setViewportSize({ width: 390, height: 900 });
  await incoming.getByRole("button", { name: "收起", exact: true }).click();
  expect((await incomingBody.boundingBox())?.height).toBeCloseTo(384, 1);
  await page.reload();
  await expect(page.getByLabel("你的消息")).toHaveCount(1);
  await expect(
    page
      .getByLabel("Domos 的回复")
      .getByRole("button", { name: "展开", exact: true }),
  ).toBeVisible();
});

test("settings rows keep content insets across Bot, computer and settings views", async ({
  service,
  page,
}, info) => {
  test.setTimeout(60_000);
  await page.goto(service.url);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const details = page.getByRole("complementary", {
    name: "Domos的详情",
    exact: true,
  });
  await details
    .getByRole("button", { name: "工作目录与权限", exact: true })
    .click();
  const directoryRow = details
    .getByRole("region", {
      name: "工作目录",
      exact: true,
    })
    .getByRole("group");
  await expect(directoryRow).toBeVisible();
  await expect(directoryRow).toHaveCSS("padding-left", "12px");
  await expect(directoryRow).toHaveCSS("padding-right", "12px");
  const project = join(service.directory, "项目资料".repeat(15));
  await mkdir(project);
  await directoryRow
    .getByRole("button", { name: "更改目录", exact: true })
    .click();
  const picker = page.getByRole("dialog", {
    name: "选择工作目录",
    exact: true,
  });
  await picker.getByLabel("目录路径", { exact: true }).fill(project);
  await picker.getByRole("button", { name: "使用此目录", exact: true }).click();
  await expect(directoryRow).toContainText(project);

  for (const colorScheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [1360, 390]) {
      await page.setViewportSize({ width, height: 800 });
      const rows = details.locator(".panel-card > .setting-row");
      expect(await rows.count()).toBeGreaterThan(2);
      for (const row of await rows.all()) {
        await expect(row).toHaveCSS("padding-left", "12px");
        await expect(row).toHaveCSS("padding-right", "12px");
        expect(
          await row.evaluate((node) => node.scrollWidth <= node.clientWidth),
        ).toBe(true);
      }
      await details.screenshot({
        path: info.outputPath(`directory-${colorScheme}-${width}.png`),
      });
    }
  }
  await page.setViewportSize({ width: 1360, height: 800 });
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("button", { name: "用户菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  const settings = page.getByRole("main", { name: "设置", exact: true });
  for (const colorScheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [1360, 390]) {
      await page.setViewportSize({ width, height: 800 });
      const row = settings.getByRole("group", { name: "主题", exact: true });
      const inset = await row.evaluate((node) => {
        const card = node.parentElement;
        const caption = node.querySelector(".setting-caption");
        if (!card || !caption) throw new Error("设置内容不可见");
        return (
          caption.getBoundingClientRect().left -
          card.getBoundingClientRect().left
        );
      });
      expect(inset).toBeCloseTo(12, 0);
      await settings.screenshot({
        path: info.outputPath(`settings-${colorScheme}-${width}.png`),
      });
      for (const name of ["AI 服务"]) {
        await settings.getByRole("tab", { name, exact: true }).click();
        const rows = settings.locator(".setting-row:visible");
        await expect(rows.first()).toBeVisible();
        await expect
          .poll(() =>
            rows.evaluateAll(
              (nodes) =>
                nodes.length > 0 &&
                nodes.every((node) => {
                  const style = getComputedStyle(node);
                  return (
                    style.paddingLeft === "12px" &&
                    style.paddingRight === "12px" &&
                    node.scrollWidth <= node.clientWidth
                  );
                }),
            ),
          )
          .toBe(true);
        await settings.screenshot({
          path: info.outputPath(`${name}-${colorScheme}-${width}.png`),
        });
      }
      await settings.getByRole("tab", { name: "通用", exact: true }).click();
    }
  }
});

test("settings stay readable in both themes and compact layouts", async ({
  service,
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.goto(service.url);
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await input.fill("返回后继续编辑");
  const trigger = page.getByRole("button", { name: "用户菜单", exact: true });
  await trigger.click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  const settings = page.getByRole("main", { name: "设置", exact: true });
  await expect(page.locator(".app-titlebar")).toHaveCount(0);
  await expect(input).toBeHidden();
  await expect(
    page.getByRole("dialog", { name: "设置", exact: true }),
  ).toHaveCount(1);
  expect((await settings.boundingBox())?.y).toBeGreaterThan(48);
  expect((await settings.boundingBox())?.height).toBeLessThan(852);
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
  await settings.getByRole("tab", { name: "AI 服务", exact: true }).click();
  await settings.getByRole("button", { name: "管理 Pi", exact: true }).click();
  const models = settings.locator(".model-catalog");
  await expect(models).not.toHaveAttribute("open");
  await models.locator("summary").focus();
  await models.locator("summary").press("Enter");
  await expect(models).toHaveAttribute("open", "");
  await expect(models.getByRole("switch").first()).toBeVisible();
  await models.locator("summary").press("Space");
  await expect(models).not.toHaveAttribute("open");
  await settings.getByRole("tab", { name: "通用", exact: true }).click();
  await search.fill("主题");
  await expect(
    settings.getByRole("tab", { name: "通用", exact: true }),
  ).toBeVisible();
  await expect(
    settings.getByRole("tab", { name: "当前电脑", exact: true }),
  ).toHaveCount(0);
  await search.fill("不存在的设置");
  await expect(settings.getByRole("status")).toHaveText("没有匹配的设置");
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(settings).toBeVisible();
  await search.fill("访问");
  await search.press("Enter");
  await expect(
    settings.getByRole("tab", { name: "当前电脑", exact: true }),
  ).toBeFocused();
  await expect(search).toHaveValue("");
  await settings.getByRole("tab", { name: "当前电脑", exact: true }).click();
  await settings.getByRole("button", { name: /^工作环境/ }).click();
  await settings
    .getByRole("button", { name: "添加容器环境", exact: true })
    .click();
  const add = page.getByRole("dialog", {
    name: "添加容器环境",
    exact: true,
  });
  let additions = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/rpc/computer/add")) additions++;
  });
  await add.getByLabel("环境名称", { exact: true }).fill("尚未添加");
  await add.getByRole("button", { name: "取消", exact: true }).click();
  await expect(add).toHaveCount(0);
  await settings
    .getByRole("button", { name: "添加容器环境", exact: true })
    .click();
  await expect(add.getByLabel("环境名称", { exact: true })).toHaveValue(
    "尚未添加",
  );
  await add.getByRole("button", { name: "取消", exact: true }).click();
  await settings.getByRole("tab", { name: "通用", exact: true }).click();
  await settings.getByRole("tab", { name: "当前电脑", exact: true }).click();

  await settings.getByRole("button", { name: /^工作环境/ }).click();
  await settings
    .getByRole("button", { name: "添加容器环境", exact: true })
    .click();
  await expect(add.getByLabel("环境名称", { exact: true })).toHaveValue(
    "容器环境",
  );
  await page.keyboard.press("Escape");
  await expect(settings).toBeVisible();
  expect(additions).toBe(0);
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(
      settings.getByRole("tab", { name: "AI 服务", exact: true }),
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
  await settings.getByRole("button", { name: "关闭设置", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "用户菜单", exact: true }),
  ).toBeFocused();
  await expect(input).toHaveText("返回后继续编辑");
  await expect(page.locator("#bot-details")).toBeVisible();
  await trigger.click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  await page.setViewportSize({ width: 768, height: 800 });
  await expect(settings).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await expect(page.locator(".settings-window")).toBeHidden();
  const details = page.getByRole("dialog", { name: "Bot详情", exact: true });
  await expect(details).toBeVisible();
  await expect
    .poll(() =>
      details.evaluate((node) => node.contains(document.activeElement)),
    )
    .toBe(true);
  await page.keyboard.press("Tab");
  await expect(details.locator(":focus")).toHaveCount(1);
});

test("control geometry and interaction states stay consistent", async ({
  service,
  page,
}) => {
  await page.goto(service.url);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const details = page.getByRole("complementary", { name: "Domos的详情" });
  const edit = details.getByRole("button", { name: "编辑", exact: true });
  const inset = await edit.evaluate((item) => {
    const box = item.getBoundingClientRect();
    const header = item.parentElement?.getBoundingClientRect();
    return {
      left: box.left - (header?.left ?? 0),
      top: box.top - (header?.top ?? 0),
      bottom: (header?.bottom ?? 0) - box.bottom,
    };
  });
  expect(inset.left).toBeGreaterThanOrEqual(0);
  expect(inset.top).toBeGreaterThanOrEqual(0);
  expect(inset.bottom).toBeGreaterThanOrEqual(0);
  await edit.click();
  const name = details.getByRole("textbox", { name: "名字", exact: true });
  const inputHeight = (await name.boundingBox())?.height;
  expect(inputHeight).toBe(40);
  await expect(details.locator(".panel-header")).toHaveCSS(
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
  await details.getByRole("button", { name: "返回", exact: true }).click();
  const model = details.getByRole("combobox", {
    name: "模型",
    exact: true,
  });
  expect((await model.boundingBox())?.height).toBeGreaterThanOrEqual(32);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await page.getByRole("tab", { name: "Computer", exact: true }).click();
  await page.getByRole("button", { name: "电脑设置", exact: true }).click();
  await details
    .getByRole("region", { name: "执行环境", exact: true })
    .locator("summary")
    .click();
  const select = details.getByRole("combobox", {
    name: "执行环境",
    exact: true,
  });
  expect((await select.boundingBox())?.height).toBe(inputHeight);
  await expect(select).toHaveCSS("font-size", "13px");
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await details.getByRole("tab", { name: "Bot", exact: true }).click();
  await details.getByRole("button", { name: /^记忆(?:\s|$)/ }).click();
  const memory = page.locator(".dialog-popup").first();
  await memory.getByRole("button", { name: "新增记忆", exact: true }).click();
  const checkbox = memory.getByRole("checkbox", { name: "共享给所有 Bot" });
  await expect(checkbox).toHaveCSS("width", "16px");
  await expect(checkbox).toHaveCSS("margin", "0px");
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await memory.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await details.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "用户菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  const settings = page.getByRole("main", { name: "设置", exact: true });
  const nav = settings.getByRole("tablist", { name: "设置分区" });
  await expect(nav).toHaveAttribute("aria-orientation", "vertical");
  const appearance = settings.getByRole("tab", { name: "通用", exact: true });
  const computer = settings.getByRole("tab", {
    name: "AI 服务",
    exact: true,
  });
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
    settings.getByRole("tab", { name: "AI 服务", exact: true }),
  ).toBeFocused();
});

test("user bubbles retain readable local colors for every Bot hue in both themes", async ({
  service,
  page,
}) => {
  test.setTimeout(120_000);
  await service.control({ content: "助手保持中性色。" });
  await page.goto(service.url);
  await page
    .getByLabel("消息", { exact: true })
    .fill("请看 https://example.com/reading");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const close = page
    .locator("#bot-details")
    .getByRole("button", { name: "关闭", exact: true });
  if (await close.isVisible()) await close.click();
  const bubble = page.locator('.message-bubble[data-side="outgoing"]').last();
  await expect(bubble.locator(".message-link")).toBeVisible();
  const colors: string[] = characterColors.map(({ color }) => color);
  for (let r = 0; r <= 255; r += 17)
    for (let g = 0; g <= 255; g += 17)
      for (let b = 0; b <= 255; b += 17)
        colors.push(
          `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`,
        );
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(bubble).toHaveCSS(
      "color",
      theme === "light" ? "rgb(255, 255, 255)" : "rgb(245, 245, 245)",
    );
    const palettes = colors.map((color) => ({
      color,
      ...userBubbleColors(color),
    }));
    const failures = await bubble.evaluate((node, palettes) => {
      const surface = node.closest<HTMLElement>(".chat-surface");
      if (!surface) throw new Error("Chat surface required");
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas required for contrast measurement");
      const luminance = (color: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = [...ctx.getImageData(0, 0, 1, 1).data].map((v) => {
          const s = v / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        if (r === undefined || g === undefined || b === undefined)
          throw new Error("RGB channels required");
        return r * 0.2126 + g * 0.7152 + b * 0.0722;
      };
      const ratio = (ink: string, background: string) => {
        const a = luminance(ink),
          b = luminance(background);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      const linkElement = node.querySelector("a");
      if (!linkElement) throw new Error("User link required");
      const quote = document.createElement("blockquote");
      quote.className = "message-reply";
      quote.textContent = "引用内容";
      node.append(quote);
      const saved = surface.getAttribute("style");
      const failures: { color: string; target: string; ratio: number }[] = [];
      for (const { color, light, dark } of palettes) {
        surface.style.setProperty("--bot-color", color);
        surface.style.setProperty("--user-bubble-light", light);
        surface.style.setProperty("--user-bubble-dark", dark);
        const style = getComputedStyle(node);
        const selection = getComputedStyle(node, "::selection");
        for (const [target, ink, background] of [
          ["body", style.color, style.backgroundColor],
          ["link", getComputedStyle(linkElement).color, style.backgroundColor],
          [
            "quote",
            getComputedStyle(quote).color,
            getComputedStyle(quote).backgroundColor,
          ],
          ["selection", selection.color, selection.backgroundColor],
        ] as const) {
          const measured = ratio(ink, background);
          if (measured < 4.5) failures.push({ color, target, ratio: measured });
        }
      }
      surface.setAttribute("style", saved ?? "");
      quote.remove();
      return failures.slice(0, 8);
    }, palettes);
    expect(failures).toEqual([]);
    const link = bubble.locator(".message-link");
    await link.hover();
    await expect(link).toHaveCSS(
      "color",
      await bubble.evaluate((node) => getComputedStyle(node).color),
    );
    await link.focus();
    await expect(link).toHaveCSS(
      "color",
      await bubble.evaluate((node) => getComputedStyle(node).color),
    );
    await page.mouse.move(1, 1);
    await link.evaluate((node) => node.blur());
    await page.screenshot({ path: `test-results/user-bubble-${theme}.png` });
  }
});

test("saved Bot colors retain their original bubble fill when contrast is sufficient", async ({
  service,
  page,
}) => {
  const api = createORPCClient<typeof appClient>(
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  const bot = (await api.bots.list())[0];
  if (!bot) throw new Error("Bot required");
  await service.control({ content: "保留合格原色。" });
  await page.goto(service.url);
  await page.getByLabel("消息", { exact: true }).fill("核对气泡配色");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  for (const [color, themes] of [
    ["#894ef0", ["light"]],
    ["#73479f", ["light", "dark"]],
  ] as const) {
    const profile = await api.work.profile({ botId: bot.id });
    await api.work.update({
      botId: bot.id,
      name: profile.name,
      instructions: profile.instructions,
      avatar: characterSeed("star", color),
      revision: profile.revision,
      requestId: crypto.randomUUID(),
    });
    await page.reload();
    for (const theme of themes) {
      await page.emulateMedia({ colorScheme: theme });
      await expect
        .poll(() =>
          page
            .locator('.message-bubble[data-side="outgoing"]')
            .last()
            .evaluate((node) => {
              const canvas = document.createElement("canvas");
              canvas.width = canvas.height = 1;
              const ctx = canvas.getContext("2d");
              if (!ctx) throw new Error("Canvas required");
              ctx.fillStyle = getComputedStyle(node).backgroundColor;
              ctx.fillRect(0, 0, 1, 1);
              return `#${[...ctx.getImageData(0, 0, 1, 1).data]
                .slice(0, 3)
                .map((v) => v.toString(16).padStart(2, "0"))
                .join("")}`;
            }),
        )
        .toBe(color);
    }
  }
});
