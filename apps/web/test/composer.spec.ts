import { characterColors } from "@domos/ui/characters";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { expect } from "@playwright/test";
import { png } from "../../../packages/agent/test/fixtures/png.ts";
import type { AppRouter } from "../../api/src/router.ts";
import {
  attachFiles,
  chooseAppearance,
  expectTextContrast,
} from "./fixtures/chat-ui.ts";
import { test } from "./fixtures/service.ts";

test("composer shares Bot colors across voice, send, attachments and stop in both themes", async ({
  service,
  page,
}, info) => {
  await page.goto(service.url);
  await page.addStyleTag({
    content: ".composer-action button { transition: none; }",
  });
  const input = page.getByLabel("消息", { exact: true });
  const action = page.locator(".composer-action button");
  await expect(action).toHaveAttribute("data-action", "voice");
  await expect(action).toBeDisabled();
  await expect(action).toHaveAccessibleName("语音输入（暂未开放）");
  const bounds = await action.boundingBox();
  let background = "";
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(action).toHaveCSS("opacity", "1");
    const color = await action.evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    );
    if (background) expect(color).toBe(background);
    background = color;
    const contrast = await action.evaluate(
      (node, colors) => {
        const owner = node.closest<HTMLElement>(".chat-surface");
        if (!owner) throw new Error("Chat required");
        const previous = owner.style.getPropertyValue("--bot-color");
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas required for color measurement");
        try {
          const luminance = (color: string) => {
            context.fillStyle = color;
            context.fillRect(0, 0, 1, 1);
            const [r = 0, g = 0, b = 0] = [
              ...context.getImageData(0, 0, 1, 1).data,
            ]
              .slice(0, 3)
              .map((value) => {
                const channel = value / 255;
                return channel <= 0.04045
                  ? channel / 12.92
                  : ((channel + 0.055) / 1.055) ** 2.4;
              });
            return r * 0.2126 + g * 0.7152 + b * 0.0722;
          };
          return colors.map(({ color }) => {
            owner.style.setProperty("--bot-color", color);
            const style = getComputedStyle(node);
            const background = luminance(style.backgroundColor);
            const foreground = luminance(style.color);
            return {
              actual: style.backgroundColor,
              expected: `rgb(${color
                .slice(1)
                .match(/../g)
                ?.map((part) => Number.parseInt(part, 16))
                .join(", ")})`,
              ratio:
                (Math.max(background, foreground) + 0.05) /
                (Math.min(background, foreground) + 0.05),
            };
          });
        } finally {
          if (previous) owner.style.setProperty("--bot-color", previous);
          else owner.style.removeProperty("--bot-color");
        }
      },
      [
        ...characterColors,
        ...["#000000", "#ffffff", "#808080", "#ffffaa", "#123456"].map(
          (color) => ({ color }),
        ),
      ],
    );
    for (const { ratio, actual, expected } of contrast) {
      expect(actual).toBe(expected);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
    const foreground = await action.evaluate(
      (node) => getComputedStyle(node).color,
    );
    await page
      .locator(".message-composer")
      .screenshot({ path: info.outputPath(`composer-voice-${theme}.png`) });
    await input.fill("发送内容");
    await expect(action).toHaveAttribute("data-action", "send");
    await expect(action).toBeEnabled();
    await expect(action).toHaveCSS("color", foreground);
    expect((await action.boundingBox())?.width).toBe(bounds?.width);
    await page
      .locator(".message-composer")
      .screenshot({ path: info.outputPath(`composer-send-${theme}.png`) });
    await input.fill("   ");
    await expect(action).toHaveAttribute("data-action", "voice");
  }
  await attachFiles(page, {
    name: "资料.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("附件"),
  });
  await expect(action).toHaveAttribute("data-action", "send");
  await expect(action).toBeEnabled();
  await page
    .getByRole("button", { name: "移除文件 资料.txt", exact: true })
    .click();
  await expect(action).toHaveAttribute("data-action", "voice");
  await service.control("gate");
  await input.fill("检查按钮状态");
  await action.click();
  await expect(action).toHaveAttribute("data-action", "stop");
  await expect(action).toBeEnabled();
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(action).toHaveCSS("background-color", background);
    await page
      .locator(".message-composer")
      .screenshot({ path: info.outputPath(`composer-stop-${theme}.png`) });
  }
  await input.fill("补充材料");
  await expect(action).toHaveAttribute("data-action", "send");
  await input.fill("");
  await expect(action).toHaveAttribute("data-action", "stop");
  await action.click();
  await expect(action).toHaveAttribute("data-action", "voice");
  await expect(action).toBeDisabled();
});

test("composer grows, shrinks, and keeps one focus surface in both themes", async ({
  service,
  page,
}) => {
  await page.goto(service.url);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  const input = page.getByLabel("消息", { exact: true });
  const form = page.locator(".message-composer");
  const initial = await form.boundingBox();
  expect(initial?.height).toBeGreaterThanOrEqual(44);
  expect(initial?.height).toBeLessThanOrEqual(60);
  const add = page.getByRole("button", { name: "添加内容", exact: true });
  const fieldBox = await page.locator(".composer-field").boundingBox();
  const addBox = await add.boundingBox();
  if (!fieldBox || !addBox) throw new Error("Composer controls missing");
  expect(addBox.x).toBeGreaterThanOrEqual(fieldBox.x);
  expect(addBox.x + addBox.width).toBeLessThan(fieldBox.x + fieldBox.width);
  expect(addBox.width).toBe(addBox.height);
  expect(addBox.height).toBeLessThanOrEqual(fieldBox.height);
  expect(
    await page.locator(".composer-field").getByRole("button").count(),
  ).toBe(2);
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
    const input = page.getByLabel("消息", { exact: true });
    await input.fill("继续整理资料");
    await input.clear();
    await expect(input).toHaveAttribute("data-empty", "true");
    await expectTextContrast(page);
    await input.click();
    await expect(input).toHaveCSS("outline-style", "none");
    await expect(input).toHaveCSS("font-size", "14px");
    expect(
      await input.evaluate(
        (node) => getComputedStyle(node, "::before").fontSize,
      ),
    ).toBe("13px");
    await page.screenshot({ path: `test-results/workspace-${theme}.png` });
  }
  await page.emulateMedia({ forcedColors: "active" });
  await expect(input).toHaveCSS("outline-style", "solid");
  await page.emulateMedia({ forcedColors: "none" });
  await page
    .locator("#bot-details")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(input).toBeVisible();
  const action = await page
    .getByRole("button", { name: "语音输入（暂未开放）", exact: true })
    .boundingBox();
  expect(action?.width).toBeGreaterThanOrEqual(32);
  expect(action?.height).toBeGreaterThanOrEqual(32);
  expect((await form.boundingBox())?.height).toBeLessThanOrEqual(60);
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

test("composer grows with wrapping and resets after clearing", async ({
  service,
  page,
}) => {
  await page.goto(service.url);
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

test("composer menu adds task materials, keeps drafts, and fits both themes", async ({
  service,
  page,
}) => {
  async function checkAlignment(selector: string) {
    const layout = await page.locator(selector).evaluate((element) => {
      const text = Array.from(element.childNodes).find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
      );
      if (!text) throw new Error("Expected text beside material tokens");
      const range = document.createRange();
      range.selectNodeContents(text);
      const bounds = range.getBoundingClientRect();
      const center = bounds.y + bounds.height / 2;
      return {
        fontSize: getComputedStyle(element).fontSize,
        tokens: Array.from(
          element.querySelectorAll(".message-material-token"),
        ).map((token) => {
          const box = token.getBoundingClientRect();
          return {
            offset: Math.abs(box.y + box.height / 2 - center),
            fontSize: getComputedStyle(token).fontSize,
          };
        }),
      };
    });
    for (const token of layout.tokens) {
      expect(token.offset).toBeLessThanOrEqual(2);
      expect(token.fontSize).toBe(layout.fontSize);
    }
  }
  const rpc: RouterClient<AppRouter> = createORPCClient(
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  const bot = (await rpc.bots.list())[0];
  if (!bot) throw new Error("Missing Bot");
  const skill = await rpc.work.skills.save({
    botId: bot.id,
    id: crypto.randomUUID(),
    content:
      "---\nname: report\ndescription: Write a report\n---\nUse the selected references.",
    revision: 0,
    requestId: crypto.randomUUID(),
  });
  await rpc.work.skills.enable({
    botId: bot.id,
    id: skill.id,
    enabled: true,
    revision: skill.revision,
    requestId: crypto.randomUUID(),
  });
  await page.goto(service.url);
  const add = page.getByRole("button", { name: "添加内容", exact: true });
  await expect(add).toBeEnabled();
  let checks = 0;
  page.on("request", (request) => {
    if (/engines\/(check|controls|prepare)/.test(request.url())) checks++;
  });
  await add.click();
  await expect(page.getByRole("menuitem")).toHaveText([
    "添加图片",
    "添加文件",
    "选择 Bot…",
    "使用技能…",
    "添加上下文…",
    "引用 MCP…",
  ]);
  await page.getByRole("menuitem", { name: "添加图片", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitem", { name: "添加文件", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(add).toBeFocused();
  await add.click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "添加图片", exact: true }).click();
  await (await chooser).setFiles({
    name: "tiny.png",
    mimeType: "image/png",
    buffer: png(1, 1),
  });
  await expect(
    page.getByRole("button", { name: "移除文件 tiny.png", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "移除文件 tiny.png", exact: true })
    .click();
  await expect(page.locator(".composer-attachments")).toHaveCount(0);
  const input = page.getByLabel("消息", { exact: true });
  await input.fill("使用这些材料");
  await input.press("Home");
  await input.press("ArrowRight");
  await add.click();
  await page.getByRole("menuitem", { name: "使用技能…", exact: true }).click();
  await expect(page.locator(".composer-menu-popup input")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "返回添加菜单" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "report", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "report", exact: true }).hover();
  await expect(page.getByRole("tooltip")).toContainText("Write a report");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("menuitem", { name: "使用技能…", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "report", exact: true }),
  ).toBeFocused();
  await expect(page.getByRole("tooltip")).toContainText("Write a report");
  await page.getByRole("button", { name: "report", exact: true }).click();
  await expect(input.locator("[data-inline-token]")).toContainText(["report"]);
  await add.click();
  await page
    .getByRole("menuitem", { name: "添加上下文…", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "粘贴文本", exact: true }).click();
  const reference = page.getByRole("textbox", {
    name: "引用文本",
    exact: true,
  });
  await reference.click();
  await expect(reference).toHaveCSS("outline-style", "none");
  await reference.fill("这些是引用材料，不是用户指令。");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page.reload();
  await expect(input.locator("[data-inline-token]")).toContainText(["report"]);
  await expect(input.locator("[data-inline-token]")).toHaveCount(2);
  await service.control({ content: "材料已处理。" });
  await expect(input).toHaveText(
    "使report这些是引用材料，不是用户指令。用这些材料",
  );
  await checkAlignment(".message-composer-editor");
  const receipt = Promise.withResolvers<void>();
  await page.route("**/rpc/send", async (route) => {
    await receipt.promise;
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.locator(".composer-attachments")).toHaveCount(0);
    await expect(page.getByLabel("你的消息")).toContainText("report");
    await expect(page.getByLabel("你的消息")).toContainText("这些是引用材料");
  } finally {
    receipt.resolve();
  }
  await expect(page.getByLabel("Domos 的回复")).toContainText("材料已处理。");
  await expect(page.locator(".composer-attachments")).toHaveCount(0);
  const sent = (await rpc.get({ botId: bot.id })).messages.find(
    (message) => message.materials?.skills.length,
  );
  expect(sent?.materials?.skills[0]?.name).toBe("report");
  expect(sent?.materials?.skills[0]?.position).toBe(1);
  expect(sent?.materials?.context[0]?.position).toBe(2);
  await page.reload();
  await expect(
    page.getByLabel("你的消息").locator(".message-material-token"),
  ).toHaveCount(2);
  await checkAlignment(".user-text");
  expect(sent?.materials?.context[0]?.text).toBe(
    "这些是引用材料，不是用户指令。",
  );
  await add.click();
  await page
    .getByRole("menuitem", { name: "添加上下文…", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "引用消息", exact: true }).click();
  await page.getByRole("button", { name: "材料已处理。", exact: true }).click();
  await expect(input.locator("[data-inline-token]")).toHaveText([
    "材料已处理。",
  ]);
  await input.press("End");
  await input.press("Backspace");
  await expect(input.locator("[data-inline-token]")).toHaveCount(0);
  await input.fill("请按检查本周改动。");
  await input.press("Home");
  await input.press("ArrowRight");
  await add.click();
  await page.getByRole("menuitem", { name: "使用技能…", exact: true }).click();
  await page.getByRole("button", { name: "report", exact: true }).click();
  await page
    .locator("#bot-details")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  for (const [theme, label] of [
    ["light", "浅色"],
    ["dark", "深色"],
  ] as const) {
    await page.setViewportSize({ width: 1360, height: 900 });
    await chooseAppearance(page, label);
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await add.click();
      const popup = page.locator(".composer-menu-popup");
      await expect(popup).toBeVisible();
      await expect(popup).toHaveCSS("opacity", "1");
      const box = await popup.boundingBox();
      expect(
        box && box.x >= 0 && box.x + box.width <= width && box.y >= 0,
      ).toBeTruthy();
      await page.screenshot({
        path: `test-results/composer-menu-${theme}-${width}.png`,
      });
      await page.keyboard.press("Escape");
    }
  }
  expect(checks).toBe(0);
});

test("composer previews pasted images and compact documents in both themes", async ({
  service,
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(service.url);
  await expect(
    page.getByRole("button", { name: "添加内容", exact: true }),
  ).toBeEnabled();
  const input = page.getByLabel("消息", { exact: true });
  await page.evaluate(async () => navigator.clipboard.writeText("普通文字"));
  await input.focus();
  await page.keyboard.press("ControlOrMeta+V");
  await expect(input).toHaveText("普通文字");
  await page.evaluate(
    async (bytes) => {
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": new Blob([new Uint8Array(bytes)], { type: "image/png" }),
        }),
      ]);
    },
    Array.from(png(360, 640)),
  );
  await page.keyboard.press("ControlOrMeta+V");
  const drafts = page.locator(".composer-attachments");
  const images = drafts.locator(".attachment-image");
  await expect(images).toHaveCount(1);
  await attachFiles(page, [
    { name: "wide.png", mimeType: "image/png", buffer: png(640, 360) },
    {
      name: "report.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\n%%EOF\n"),
    },
    {
      name: "产品需求与验收清单.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Notes\n"),
    },
  ]);
  await expect(drafts.locator(".attachment")).toHaveCount(4);
  await expect(images).toHaveCount(2);
  await expect(input).toHaveText("普通文字");
  await expect(drafts).toContainText("PDF ·");
  await expect(drafts).toContainText("MD ·");
  await page.reload();
  await expect(images).toHaveCount(2);
  const remove = images.first().getByRole("button");
  await page.mouse.move(0, 0);
  await expect(remove).toHaveCSS("opacity", "0");
  await images.first().hover();
  await expect(remove).toHaveCSS("opacity", "1");
  await page.mouse.move(0, 0);
  await images.first().getByRole("link").focus();
  await page.keyboard.press("Tab");
  await expect(remove).toBeFocused();
  await expect(remove).toHaveCSS("opacity", "1");
  await page
    .locator("#bot-details")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  for (const [theme, label] of [
    ["light", "浅色"],
    ["dark", "深色"],
  ] as const) {
    await page.setViewportSize({ width: 1360, height: 900 });
    await chooseAppearance(page, label);
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await input.focus();
      await expect(async () => {
        const bounds = await drafts.boundingBox();
        expect(
          bounds && bounds.x >= 0 && bounds.x + bounds.width <= width,
        ).toBeTruthy();
        for (const image of await images.all()) {
          const box = await image.boundingBox();
          expect(
            box && box.width === box.height && box.width <= 150,
          ).toBeTruthy();
          await expect(image).toHaveText("");
        }
        const first = await images.first().boundingBox();
        const second = await images.last().boundingBox();
        expect(
          first && second && first.y === second.y && second.x > first.x,
        ).toBeTruthy();
        const document = await drafts
          .locator(".file-attachment")
          .first()
          .boundingBox();
        expect(document && document.width <= 300).toBeTruthy();
      }).toPass({ timeout: 5000 });
      await images.first().hover();
      await page.screenshot({
        path: `test-results/composer-attachments-${theme}-${width}.png`,
      });
    }
  }
  await remove.focus();
  await page.keyboard.press("Enter");
  await expect(images).toHaveCount(1);
  await page.reload();
  await expect(images).toHaveCount(1);
  await expect(drafts.locator(".file-attachment")).toHaveCount(2);
});

test("material menus keep descriptions and long catalogs within the viewport", async ({
  service,
  page,
}, testInfo) => {
  const names = Array.from(
    { length: 20 },
    (_, index) => `project-${index}-review-documentation-and-current-workspace`,
  );
  await service.control({
    nativeSkills: names.map((name) => ({
      name,
      description: "检查项目文件、测试结果和当前修改。".repeat(12),
      path: `/project/skills/${name}/SKILL.md`,
      source: "project",
    })),
  });
  await page.goto(service.url);
  const add = page.getByRole("button", { name: "添加内容", exact: true });
  await expect(add).toBeEnabled();
  await page
    .locator("#bot-details")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  for (const [theme, label] of [
    ["light", "浅色"],
    ["dark", "深色"],
  ] as const) {
    await page.setViewportSize({ width: 1360, height: 900 });
    await chooseAppearance(page, label);
    for (const width of [1360, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await add.click();
      const popup = page.locator(".composer-menu-popup");
      await expect(popup).toHaveCSS("opacity", "1");
      const anchor = await add.boundingBox();
      const menu = await popup.boundingBox();
      expect(Math.abs((anchor?.x ?? 0) - (menu?.x ?? 0))).toBeLessThanOrEqual(
        2,
      );
      expect((menu?.y ?? 0) + (menu?.height ?? 0)).toBeLessThan(anchor?.y ?? 0);
      await page
        .getByRole("menuitem", { name: "使用技能…", exact: true })
        .click();
      await expect(popup.locator("input")).toHaveCount(0);
      const first = page.getByRole("button", { name: names[0], exact: true });
      await expect(first).toBeFocused();
      await first.press("End");
      await expect(
        page.getByRole("button", { name: names.at(-1), exact: true }),
      ).toBeFocused();
      expect(
        await page
          .locator(".composer-picker-list")
          .evaluate((element) => element.scrollTop),
      ).toBeGreaterThan(0);
      await page.keyboard.press("Home");
      await expect(first).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(
        page.getByRole("button", { name: names[1], exact: true }),
      ).toBeFocused();
      await page.keyboard.press("ArrowUp");
      await first.hover();
      const detail = page.getByRole("tooltip");
      await expect(detail).toContainText(
        `/project/skills/${names[0]}/SKILL.md`,
      );
      const bounds = await detail.boundingBox();
      expect(
        bounds &&
          bounds.x >= 0 &&
          bounds.y >= 0 &&
          bounds.x + bounds.width <= width &&
          bounds.y + bounds.height <= 900,
      ).toBeTruthy();
      await expect(first.locator("span")).toHaveCSS(
        "text-overflow",
        "ellipsis",
      );
      await page.screenshot({
        path: testInfo.outputPath(`skills-${theme}-${width}.png`),
      });
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("menuitem", { name: "使用技能…", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(add).toBeFocused();
    }
  }
  await add.click();
  await page
    .getByRole("menuitem", { name: "添加上下文…", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "粘贴文本", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "引用文本", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("menuitem", { name: "粘贴文本", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("menuitem", { name: "添加上下文…", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(add).toBeFocused();
});
