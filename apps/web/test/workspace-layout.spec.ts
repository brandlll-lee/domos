import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { layout } from "@domos/ui/tokens";
import { expect } from "@playwright/test";
import {
  chooseAppearance,
  expectTextContrast,
  openDetails,
} from "./fixtures/chat-ui.ts";
import { test } from "./fixtures/service.ts";

test("chat gutters align within the content limit while panels resize", async ({
  service,
  page,
}) => {
  test.setTimeout(60_000);
  const code = "long_identifier_".repeat(24);
  const answer = `**回复已完成。**\n\n这是一段完整交付的消息，用来检查聊天区域的自然换行。\n\n\`\`\`text\n${code}\n\`\`\`\n\n| 名称 | 说明 |\n| --- | --- |\n| 文件 | ${code} |`;
  await service.control({ content: answer });
  await page.goto(service.url);
  const input = page.getByLabel("消息", { exact: true });
  await expect(input).toBeEnabled();
  await input.fill("请完整回复，检查长消息能使用规定的气泡宽度。".repeat(10));
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const reply = page.getByLabel("Domos 的回复").locator(".message-bubble");
  await expect(reply.locator("pre code")).toHaveText(code, { timeout: 30_000 });
  const outgoing = page.getByLabel("你的消息").locator(".message-bubble");
  for (const viewport of [
    { width: 1600, height: 900 },
    { width: 940, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 700 },
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
      expect(messages.width).toBeGreaterThanOrEqual(
        Math.min(
          panel.width * 0.9,
          await page
            .locator(".messages")
            .evaluate((node) =>
              Number.parseFloat(getComputedStyle(node).maxWidth),
            ),
        ),
      );
      expect(bubble.x).toBeGreaterThanOrEqual(messages.x);
      expect(bubble.x + bubble.width).toBeLessThanOrEqual(
        messages.x + messages.width + 1,
      );
      expect(sent.width).toBeLessThanOrEqual(messages.width * 0.9 + 1);
      expect(sent.x + sent.width).toBeCloseTo(messages.x + messages.width, 0);
      await expect(reply).toHaveCSS("font-size", "13.5px");
      await expect(reply).toHaveCSS("line-height", "20px");
      await expect(reply.locator("strong")).toHaveCSS("font-weight", "500");
      await expect(page.locator(".chat-preview strong").first()).toHaveCSS(
        "font-size",
        "13px",
      );
      await expect(page.locator(".conversation-row-title").first()).toHaveText(
        Array.from("请完整回复，检查长消息能使用规定的气泡宽度。".repeat(10))
          .slice(0, 40)
          .join(""),
      );
      await expect(outgoing).toHaveCSS(
        "color",
        await reply.evaluate((element) => getComputedStyle(element).color),
      );
      await expectTextContrast(page);
      const overflow = await page
        .locator(".transcript")
        .evaluate((element) => ({
          width: element.clientWidth,
          content: element.scrollWidth,
          code: (element.querySelector("pre") as HTMLElement).scrollWidth,
          codeWidth: (element.querySelector("pre") as HTMLElement).clientWidth,
          table: (element.querySelector(".markdown-table") as HTMLElement)
            .scrollWidth,
          tableWidth: (element.querySelector(".markdown-table") as HTMLElement)
            .clientWidth,
        }));
      expect(overflow.content).toBeLessThanOrEqual(overflow.width + 1);
      expect(overflow.code).toBeGreaterThan(overflow.codeWidth);
      expect(overflow.table).toBeGreaterThan(overflow.tableWidth);
      expect(
        await page.locator("body").evaluate((element) => element.scrollWidth),
      ).toBe(viewport.width);
      await page.screenshot({
        path: `test-results/chat-density-${viewport.width}-${theme}.png`,
      });
    }
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(page.locator(".workspace")).not.toHaveAttribute("data-mobile");
  const details = await openDetails(page);
  const inspector = page.locator('.workspace-panel[data-side="inspector"]');
  await expect(inspector).toHaveAttribute("data-open", "");
  await expect(inspector).not.toHaveAttribute("data-modal");
  await expect(inspector).toHaveCSS("translate", "none");
  for (const zoom of [1, 1.25, 1.5]) {
    await page.evaluate((value) => {
      document.documentElement.style.zoom = String(value);
    }, zoom);
    const handle = page.getByRole("separator", { name: "调整详情宽度" });
    await expect
      .poll(async () => (await handle.boundingBox())?.x ?? Infinity)
      .toBeLessThan(1920 - layout.inspector.min / 2);
    await handle.hover();
    const box = await handle.boundingBox();
    if (!box) throw new Error("Details resize handle missing");
    await page.mouse.move(box.x + box.width / 2, box.y + 100);
    await page.mouse.down();
    await expect(page.locator(".workspace-content")).toHaveAttribute(
      "data-resizing",
      "true",
    );
    for (const distance of [40, 80, 120, 60, 0]) {
      await page.mouse.move(box.x - distance, box.y + 100, { steps: 3 });
      const chat = await page.locator(".conversation").boundingBox();
      const panel = await details.boundingBox();
      if (!chat || !panel) throw new Error("Chat panel missing");
      const transcript = await page.locator(".transcript").evaluate((node) => {
        const style = getComputedStyle(node);
        return (
          (parseFloat(style.width) -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight)) *
          parseFloat(getComputedStyle(document.documentElement).zoom)
        );
      });
      const limit = await page
        .locator(".messages")
        .evaluate(
          (node) =>
            Number.parseFloat(getComputedStyle(node).maxWidth) *
            Number.parseFloat(getComputedStyle(document.documentElement).zoom),
        );
      expect(
        (await page.locator(".messages").boundingBox())?.width,
      ).toBeCloseTo(Math.min(transcript, limit), 0);
      expect(chat.x + chat.width).toBeLessThanOrEqual(panel.x + 1);
      expect(
        await page
          .locator(".transcript")
          .evaluate((node) => node.scrollWidth - node.clientWidth),
      ).toBeLessThanOrEqual(1);
    }
    await page.mouse.up();
    await expect(page.locator(".workspace-content")).not.toHaveAttribute(
      "data-resizing",
    );
    await page.evaluate(() => document.activeViewTransition?.finished);
    const chat = await page.locator(".conversation").boundingBox();
    const sent = await outgoing.boundingBox();
    if (!chat || !sent) throw new Error("Chat panel missing");
    expect(sent.x + sent.width).toBeLessThanOrEqual(chat.x + chat.width + 1);
    await page.screenshot({ path: `test-results/chat-side-panel-${zoom}.png` });
  }
  await page.evaluate(() => {
    document.documentElement.style.zoom = "1";
  });
  await details.getByRole("button", { name: "关闭", exact: true }).click();
  await service.control({ content: "好的。" });
  await input.click();
  await input.fill("谢谢");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByLabel("Domos 的回复").last()).toHaveText("好的。");
  const short = await page
    .getByLabel("Domos 的回复")
    .last()
    .locator(".message-bubble")
    .boundingBox();
  expect(short?.width).toBeLessThan(100);
  const shortSent = await page
    .getByLabel("你的消息")
    .last()
    .locator(".message-bubble")
    .boundingBox();
  expect(shortSent?.width).toBeLessThan(100);
});

test("three columns keep the two-line identity and navigation clear at each width", async ({
  service,
  page,
}, info) => {
  await page.setViewportSize({ width: 1600, height: 960 });
  let workStreams = 0;
  await page.route("**/rpc/work/subscribe", async (route) => {
    workStreams++;
    await route.continue();
  });
  await page.goto(service.url);
  const details = page.locator("#bot-details");
  const capsule = page.getByRole("button", { name: "Bot详情", exact: true });
  await expect(details).toBeVisible();
  await expect(details.getByRole("button", { name: /^记忆/ })).toBeVisible();
  expect(workStreams).toBe(0);
  const header = details.locator(":scope > .panel-header");
  const inspectorPanel = page.locator(
    '.workspace-panel[data-side="inspector"]',
  );
  for (const platform of ["win32", "darwin"]) {
    await page.locator(".workspace").evaluate((node, value) => {
      (node as HTMLElement).dataset.platform = value;
      node.ownerDocument.documentElement.style.setProperty(
        "--window-inset-end",
        "180px",
      );
      node.ownerDocument.documentElement.style.setProperty(
        "--window-inset-start",
        "100px",
      );
    }, platform);
    for (const expanded of [false, true]) {
      await inspectorPanel.evaluate(
        (node, value) => node.toggleAttribute("data-expanded", value),
        expanded,
      );
      const close = await header
        .getByRole("button", { name: "关闭", exact: true })
        .boundingBox();
      if (!close) throw new Error("Panel close button required");
      if (platform === "win32")
        expect(close.x + close.width).toBeLessThanOrEqual(1420);
      else
        await expect(header).toHaveCSS(
          "padding-inline-start",
          expanded ? "100px" : "12px",
        );
    }
  }
  await inspectorPanel.evaluate((node) =>
    node.removeAttribute("data-expanded"),
  );
  await page.locator(".workspace").evaluate((node) => {
    node.removeAttribute("data-platform");
    node.ownerDocument.documentElement.style.removeProperty(
      "--window-inset-end",
    );
    node.ownerDocument.documentElement.style.removeProperty(
      "--window-inset-start",
    );
  });
  await expect(page.locator(".app-titlebar, .app-rail")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Bot电脑", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator(".chat-header .model-selector-trigger"),
  ).toHaveCount(0);
  const frame = await page.locator(".conversation").boundingBox();
  const pill = await capsule.boundingBox();
  if (!frame || !pill) throw new Error("Chat identity missing");
  expect(
    Math.abs(pill.x + pill.width / 2 - frame.x - frame.width / 2),
  ).toBeLessThan(1);
  const avatar = await capsule.locator(".bot-avatar").boundingBox();
  const mark = capsule.locator(".engine-mark");
  const logo = await mark.boundingBox();
  if (!logo || !avatar) throw new Error("Identity icons missing");
  const label = capsule.locator(".chat-identity-label");
  const nameplate = await label.boundingBox();
  if (!nameplate) throw new Error("Identity nameplate missing");
  expect(logo.y).toBeGreaterThan(nameplate.y);
  expect(avatar.y + avatar.height - nameplate.y).toBe(10);
  expect(nameplate.height).toBe(30);
  await expect(capsule.locator(".chat-identity-avatar")).toHaveCSS(
    "z-index",
    "1",
  );
  await expect(label).toHaveCSS("border-radius", "8px");
  await expect(label).not.toHaveCSS("box-shadow", "none");

  await expect(capsule.locator(".chat-identity-avatar")).toHaveCSS(
    "width",
    "56px",
  );
  await expect(capsule.locator(".chat-identity-avatar")).toHaveCSS(
    "height",
    "56px",
  );
  await expect(mark).toHaveCSS("width", "12px");
  await expect(capsule.locator(".chat-identity-name")).toHaveCSS(
    "font-size",
    "14px",
  );
  await expect(mark).toHaveAttribute("data-provider", "pi");
  await expect(capsule.locator(".character")).toHaveCount(1);
  const footer = page.locator(".sidebar-footer");
  const composer = await page.locator(".message-composer").boundingBox();
  if (!composer) throw new Error("Composer missing");
  expect(composer.y + composer.height).toBeCloseTo(
    frame.y +
      frame.height -
      (await page
        .locator(".composer-area")
        .evaluate((node) => parseFloat(getComputedStyle(node).paddingBottom))),
    0,
  );
  await expect(
    footer.getByRole("button", { name: "应用连接", exact: true }),
  ).toBeVisible();
  await expect(
    footer.getByRole("button", { name: "用户菜单", exact: true }),
  ).toBeVisible();
  await page.getByLabel("消息", { exact: true }).fill("保留这份草稿");
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const inspector = await page
      .locator('.workspace-panel[data-side="inspector"]')
      .boundingBox();
    if (!inspector) throw new Error("Details missing");
    expect(inspector.y).toBe(frame.y);
    expect(inspector.height).toBe(frame.height);
    expect(inspector.x).toBeCloseTo(frame.x + frame.width, 0);
    expect(inspector.x + inspector.width).toBe(1600 - frame.y);
    expect(frame.y).toBeGreaterThan(0);
    await expect(page.locator(".workspace")).toHaveCSS(
      "background-color",
      theme === "dark" ? "rgb(12, 12, 13)" : "rgb(255, 255, 255)",
    );
    await expect(page.locator(".workspace-content")).toHaveCSS(
      "background-color",
      theme === "dark" ? "rgb(15, 15, 16)" : "rgb(253, 253, 253)",
    );
    await expect(capsule.locator(".chat-identity-avatar")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await expect(capsule.locator(".chat-identity-label")).toHaveCSS(
      "background-color",
      theme === "dark" ? "rgb(20, 20, 22)" : "rgb(255, 255, 255)",
    );
    await expect(capsule).toHaveCSS("border-width", "0px");
    await expect(capsule).toHaveCSS("box-shadow", "none");
    await capsule.hover();
    await expect(capsule).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await page.mouse.move(0, 0);
    await page.screenshot({ path: info.outputPath(`workspace-${theme}.png`) });
  }
  await details.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(details).toBeHidden();
  const expandedFrame = await page.locator(".conversation").boundingBox();
  if (!expandedFrame) throw new Error("Chat frame missing");
  expect(expandedFrame.x + expandedFrame.width).toBe(1600 - frame.y);
  await capsule.locator(".chat-identity-label").click();
  await expect(details).toBeVisible();
  await details.getByRole("button", { name: "关闭", exact: true }).click();
  await capsule.focus();
  await page.keyboard.press("Enter");
  await expect(details).toBeVisible();
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole("dialog", { name: "Bot详情", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath(`workspace-${width}.png`) });
    await page.keyboard.press("Escape");
    if (width === 390) {
      const mobileFrame = await page.locator(".conversation").boundingBox();
      expect(mobileFrame).toMatchObject({ x: 0, y: 0, width });
    }
    await expect(page.getByLabel("消息", { exact: true })).toHaveText(
      "保留这份草稿",
    );
    if (width === 768) await capsule.click();
  }
  await page.getByRole("button", { name: "联系人", exact: true }).click();
  await expect(
    footer.getByRole("button", { name: "用户菜单", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Domos", exact: true }).click();
  await expect(page.getByLabel("消息", { exact: true })).toBeVisible();
});

test("centered dialogs share stable geometry and Harness marks", async ({
  service,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(service.url);
  for (const selector of [".chat-identity", ".context-ring"]) {
    const mark = page.locator(`${selector} .engine-mark`);
    await expect(mark).toHaveAttribute("data-provider", "pi");
    await expect(mark.locator("path")).not.toHaveCount(0);
    await expect(mark).toHaveCSS("transform", "none");
  }
  for (const { width, height } of [
    { width: 1360, height: 900 },
    { width: 390, height: 380 },
  ]) {
    await page.setViewportSize({ width, height });
    if (width === 390) {
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "联系人", exact: true }).click();
    }
    await page.getByRole("button", { name: "用户菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: "设置", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "设置", exact: true });
    await expect(settings).toBeVisible();
    const size = await settings.boundingBox();
    for (const theme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(settings).toHaveCSS(
        "background-color",
        theme === "dark" ? "rgb(15, 15, 16)" : "rgb(253, 253, 253)",
      );
    }
    await expect(page.locator(".dialog-backdrop")).toHaveCSS(
      "backdrop-filter",
      "none",
    );
    await page.keyboard.press("Escape");
    if (width === 390)
      await page.getByRole("button", { name: "Bot详情", exact: true }).click();
    await page
      .locator("#bot-details")
      .getByRole("button", { name: /^记忆(?:\s|$)/ })
      .click();
    const memory = page.getByRole("dialog", { name: "记忆" });
    await expect(memory).toBeVisible();
    await expect(page.locator(".dialog-backdrop")).toBeVisible();
    await expect(page.locator(".dialog-backdrop")).toHaveCSS(
      "backdrop-filter",
      "none",
    );
    for (const state of ["list", "editor"]) {
      if (state === "editor")
        await memory
          .getByRole("button", { name: "新增记忆", exact: true })
          .click();
      for (const theme of ["dark", "light"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        await expect(memory).toHaveCSS(
          "background-color",
          theme === "dark" ? "rgb(15, 15, 16)" : "rgb(250, 250, 250)",
        );
      }
      const box = await memory.boundingBox();
      expect(box?.width).toBe(size?.width);
      expect(box?.height).toBe(size?.height);
      await expect(memory.locator(".dialog-body > .scroll-viewport")).toHaveCSS(
        "overflow-y",
        /auto|scroll/,
      );
      if (state === "editor") {
        await expect(
          memory
            .locator(".dialog-footer")
            .getByRole("button", { name: "保存", exact: true }),
        ).toBeInViewport();
        const viewport = memory.locator(".dialog-body > .scroll-viewport");
        const header = await memory.getByRole("heading").boundingBox();
        const footer = await memory.locator(".dialog-footer").boundingBox();
        await viewport.evaluate((node) => {
          node.scrollTop = node.scrollHeight;
        });
        expect(await memory.getByRole("heading").boundingBox()).toEqual(header);
        expect(await memory.locator(".dialog-footer").boundingBox()).toEqual(
          footer,
        );
        await expect(memory.locator(".scroll-viewport")).toHaveCount(1);
        if (height === 380)
          expect(
            await viewport.evaluate(
              (node) => node.scrollHeight > node.clientHeight,
            ),
          ).toBe(true);
      }
    }
    await page.keyboard.press("Escape");
    if (width === 390) {
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "联系人", exact: true }).click();
    }
    await page.getByRole("button", { name: "应用连接", exact: true }).click();
    const apps = page.getByRole("dialog", { name: "应用连接", exact: true });
    await expect(apps).toBeVisible();
    expect(await apps.boundingBox()).toEqual(size);
    await page.keyboard.press("Escape");
  }
});

test("chat input stays active while a panel closes", async ({
  service,
  page,
}) => {
  await page.goto(service.url);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const panel = page.getByRole("complementary", { name: /的详情$/ });
  await expect(panel).toBeInViewport();
  await panel.getByRole("button", { name: "关闭", exact: true }).click();
  const input = page.getByLabel("消息", { exact: true });
  await input.click();
  await input.fill("侧栏关闭时输入");
  await expect(input).toBeFocused();
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeEnabled();
});

for (const dialogName of [
  "设置",
  "工作记录",
  "应用连接",
  "添加容器环境",
] as const) {
  test(`background replies stay behind ${dialogName} during transition frames`, async ({
    service,
    page,
  }, info) => {
    await page.emulateMedia({
      colorScheme: dialogName === "设置" ? "dark" : "light",
    });
    if (dialogName === "添加容器环境")
      await page.setViewportSize({ width: 768, height: 900 });
    await page.goto(service.url);
    if (dialogName === "工作记录")
      await page.getByRole("tab", { name: "Work", exact: true }).click();
    const gated = once(service.worker, "message");
    service.worker.send("gate");
    await gated;
    await page
      .getByRole("textbox", { name: "消息", exact: true })
      .fill("后台更新");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "停止生成", exact: true }),
    ).toBeVisible();
    if (dialogName === "设置" || dialogName === "添加容器环境") {
      await page.getByRole("button", { name: "用户菜单", exact: true }).click();
      await page.getByRole("menuitem", { name: "设置", exact: true }).click();
      if (dialogName === "添加容器环境") {
        await page.getByRole("tab", { name: "当前电脑", exact: true }).click();
        await page
          .getByRole("main", { name: "设置", exact: true })
          .getByRole("button", { name: /^工作环境/ })
          .click();
        await page
          .getByRole("button", { name: "添加容器环境", exact: true })
          .click();
      }
    } else if (dialogName === "应用连接") {
      await page.getByRole("button", { name: "应用连接", exact: true }).click();
    } else {
      await page.locator(".work-row .work-open").first().click();
    }
    const dialog = page.getByRole("dialog", { name: dialogName, exact: true });
    await expect(dialog).toBeVisible();
    await page.evaluate(() => document.activeViewTransition?.finished);
    const session = await page.context().newCDPSession(page);
    const captures: string[] = [];
    const acknowledgements: Promise<unknown>[] = [];
    const capture = (event: { data: string; sessionId: number }) => {
      captures.push(event.data);
      acknowledgements.push(
        session.send("Page.screencastFrameAck", { sessionId: event.sessionId }),
      );
    };
    session.on("Page.screencastFrame", capture);
    await session.send("Page.startScreencast", {
      format: "png",
      everyNthFrame: 1,
    });
    await dialog.evaluate((node) => {
      const frames: {
        connected: boolean;
        visible: boolean;
        opacity: number;
        snapshots: boolean;
      }[] = [];
      document.documentElement.dataset.modalRecording = "true";
      const sample = () => {
        const style = getComputedStyle(node);
        frames.push({
          connected: node.isConnected,
          visible: style.visibility === "visible",
          opacity: Number(style.opacity),
          snapshots:
            Boolean(document.activeViewTransition) &&
            getComputedStyle(document.documentElement, "::view-transition")
              .display !== "none",
        });
        document.documentElement.dataset.modalFrames = JSON.stringify(frames);
        if (document.documentElement.dataset.modalRecording === "true")
          requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    try {
      const released = once(service.worker, "message");
      service.worker.send("release");
      await released;
      await expect(page.locator(".messages")).toContainText("完整回复。");
      await page.waitForFunction(
        () =>
          JSON.parse(document.documentElement.dataset.modalFrames ?? "[]")
            .length >= 20,
      );
    } finally {
      await page.evaluate(() => {
        document.documentElement.dataset.modalRecording = "false";
      });
      session.off("Page.screencastFrame", capture);
      await session.send("Page.stopScreencast");
      await Promise.all(acknowledgements);
      await session.detach();
    }
    const frames = await page.evaluate(
      () =>
        JSON.parse(document.documentElement.dataset.modalFrames ?? "[]") as {
          connected: boolean;
          visible: boolean;
          opacity: number;
          snapshots: boolean;
        }[],
    );
    await writeFile(
      info.outputPath("modal-frames.json"),
      JSON.stringify(frames),
    );
    for (const [index, capture] of captures.entries())
      await info.attach(`frame-${index}.png`, {
        body: Buffer.from(capture, "base64"),
        contentType: "image/png",
      });
    expect(captures.length).toBeGreaterThan(0);
    expect(
      frames.every(
        (frame, index) =>
          frame.connected &&
          frame.visible &&
          !frame.snapshots &&
          frame.opacity >= (frames[index - 1]?.opacity ?? 0) - 0.01,
      ),
    ).toBe(true);
    expect(frames.at(-1)?.opacity).toBe(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    if (dialogName === "添加容器环境") {
      await expect(
        page.getByRole("dialog", { name: "设置", exact: true }),
      ).toBeVisible();
      const receipt = once(service.worker, "message");
      service.worker.send({ history: 1 });
      await receipt;
      await expect(page.locator(".messages")).toContainText("历史任务 1");
      expect(
        await page.evaluate(
          () =>
            getComputedStyle(document.documentElement, "::view-transition")
              .display,
        ),
      ).toBe("none");
    }
  });
}

test("workspace empty states stay centered at every panel width", async ({
  service,
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const state of ["loading", "disabled", "failed"]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route("**/rpc/computer/services", async (route) => {
      if (state === "loading") return;
      if (state === "failed") return route.abort();
      const value = { enabled: false, available: false };
      await route.fulfill({
        json: { json: { browser: value, desktop: value } },
      });
    });
    await page.goto(service.url);
    await page.getByRole("button", { name: "Bot详情", exact: true }).click();
    await page.getByRole("tab", { name: "Computer", exact: true }).click();
    if (state === "loading")
      await expect(
        page.getByRole("heading", { name: "正在连接电脑…" }),
      ).toBeVisible();
    else if (state === "failed")
      await expect(
        page.getByRole("heading", { name: "电脑暂时无法连接" }),
      ).toBeVisible();
    else
      await expect(
        page.getByRole("button", { name: "启用桌面", exact: true }),
      ).toBeVisible();
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const [stage, empty] = await page
        .locator(".computer-workspace-stage, .computer-workspace-empty")
        .evaluateAll((elements) =>
          elements.map((element) => {
            const { x, y, width, height } = element.getBoundingClientRect();
            return { x, y, width, height };
          }),
        );
      if (!stage || !empty) throw new Error("Workspace missing");
      expect(
        Math.abs(stage.x + stage.width / 2 - empty.x - empty.width / 2),
      ).toBeLessThan(2);
      expect(empty.y).toBeGreaterThanOrEqual(stage.y);
      expect(empty.y + empty.height).toBeLessThanOrEqual(
        stage.y + stage.height,
      );
      await page.screenshot({ path: info.outputPath(`${state}-${width}.png`) });
    }
    await page.unroute("**/rpc/computer/services");
  }
});

test("chat content shares a centered width and fills narrow panes", async ({
  service,
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(service.url);
  await page
    .locator("#bot-details")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  const geometry = () =>
    page.evaluate(() => {
      const messages = document.querySelector<HTMLElement>(".messages");
      const composer = document.querySelector<HTMLElement>(
        ".composer-area > form",
      );
      const transcript = document.querySelector<HTMLElement>(".transcript");
      if (!messages || !composer || !transcript)
        throw new Error("Chat layout missing");
      const box = transcript.getBoundingClientRect();
      const gutter = Number.parseFloat(
        getComputedStyle(transcript).paddingLeft,
      );
      const cap =
        60 *
        Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
      const width = Math.min(cap, box.width - gutter * 2);
      return {
        actual: messages.getBoundingClientRect().width,
        composer: composer.getBoundingClientRect().width,
        x: messages.getBoundingClientRect().x,
        composerX: composer.getBoundingClientRect().x,
        expected: width,
        expectedX: box.x + (box.width - width) / 2,
        scrollWidth: transcript.scrollWidth,
        viewportWidth: transcript.clientWidth,
      };
    });
  for (const width of [1600, 1920, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(async () => {
        const bounds = await geometry();
        return Math.abs(bounds.actual - bounds.expected);
      })
      .toBeLessThan(1);
    const bounds = await geometry();
    expect(bounds.composer).toBeCloseTo(bounds.actual, 0);
    expect(bounds.composerX).toBeCloseTo(bounds.x, 0);
    expect(bounds.x).toBeCloseTo(bounds.expectedX, 0);
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.viewportWidth);
  }
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await expect
    .poll(async () => {
      const bounds = await geometry();
      return Math.abs(bounds.actual - bounds.expected);
    })
    .toBeLessThan(1);
  const scripted = once(service.worker, "message");
  service.worker.send({
    content:
      "| 项目 | 说明 |\n| --- | --- |\n| 宽表格 | " +
      "完整的长文本内容".repeat(40) +
      " |",
  });
  await scripted;
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill("检查长表格布局");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".message table")).toBeVisible();
  await page.route("**/rpc/send", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        defined: false,
        code: "BAD_REQUEST",
        status: 400,
        message: "发送失败",
      }),
    }),
  );
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill("检查发送错误的对齐");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const issue = page.getByRole("alert");
  await expect(issue).toBeVisible();
  await page
    .locator("#bot-details")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  const bounds = await geometry();
  expect(bounds.composer).toBeCloseTo(bounds.expected, 0);
  expect(bounds.composerX).toBeCloseTo(bounds.x, 0);
  service.worker.send({
    approval: {
      id: "column-takeover",
      title: "完成网页验证",
      kind: "permission",
      detail: "请完成网页验证后继续。",
      takeover: {
        id: "column-takeover",
        service: "browser",
        computerId: "fixture",
        revision: 1,
        state: "waiting",
        url: "https://example.com",
      },
    },
  });
  await expect(page.locator(".takeover-card")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(page.locator(".workspace")).toHaveAttribute(
    "data-mobile",
    "true",
  );
  const narrow = await geometry();
  expect(narrow.scrollWidth).toBeLessThanOrEqual(narrow.viewportWidth);
  expect(
    (await page.locator(".takeover-card").boundingBox())?.width,
  ).toBeLessThanOrEqual(narrow.actual);
  await page.setViewportSize({ width: 1600, height: 900 });
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.screenshot({
      path: info.outputPath(`chat-column-${theme}.png`),
    });
  }
});

test("empty chats retain their creation time and compact controls across layouts", async ({
  service,
  page,
}) => {
  await page.goto(service.url);
  const time = page.locator(".conversation-time time");
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
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  const searchButton = page.getByRole("button", {
    name: "搜索联系人和聊天记录",
    exact: true,
  });
  const searchDialog = page.getByRole("dialog", { name: "搜索", exact: true });
  for (const platform of ["win32", "darwin"]) {
    await page.locator(".workspace").evaluate((node, value) => {
      (node as HTMLElement).dataset.platform = value;
    }, platform);
    for (const width of [1360, 390]) {
      await page.setViewportSize({ width, height: 900 });
      if (width === 390) {
        await expect(page.locator(".workspace")).toHaveAttribute(
          "data-mobile",
          "true",
        );
        const inspector = page.locator(
          '.workspace-panel[data-side="inspector"][data-modal]',
        );
        if (await inspector.isVisible())
          await inspector
            .getByRole("button", { name: "关闭", exact: true })
            .click();
        await page.getByRole("button", { name: "联系人", exact: true }).click();
      }
      await searchButton.click();
      await expect(searchDialog.getByRole("searchbox")).toBeFocused();
      const bounds = await searchDialog.boundingBox();
      if (!bounds) throw new Error("Search dialog missing");
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y).toBeGreaterThanOrEqual(32);
      await expect(
        searchDialog.getByRole("button", { name: "关闭弹窗" }),
      ).toBeInViewport();
      await page.screenshot({
        path: `test-results/search-${platform}-${width}.png`,
      });
      await page.keyboard.press("Escape");
      await expect(searchButton).toBeFocused();
      if (width === 390) await page.keyboard.press("Escape");
    }
    await page.setViewportSize({ width: 1360, height: 900 });
  }
  await page.reload();
  await expect(time).toHaveAttribute("datetime", createdAt ?? "");
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await page.getByRole("tab", { name: "Computer", exact: true }).click();
  await page.getByRole("button", { name: "电脑设置", exact: true }).click();
  const details = page.getByRole("complementary", { name: "Domos的详情" });
  await expect(
    details.getByRole("button", { name: "更改目录", exact: true }),
  ).toBeVisible();
  await details
    .getByRole("region", { name: "执行环境", exact: true })
    .locator("summary")
    .click();
  await expect(
    details.getByRole("combobox", { name: "执行环境", exact: true }),
  ).toBeVisible();
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await details.getByRole("tab", { name: "Bot", exact: true }).click();
  await details.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(
    details.getByRole("textbox", { name: "名字", exact: true }),
  ).toBeVisible();
  await details.getByRole("button", { name: "关闭", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "联系人", exact: true }).click();
  await page.getByRole("button", { name: "用户菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  const settings = page.getByRole("main", { name: "设置", exact: true });
  await settings.getByRole("button", { name: "返回对话", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "联系人", exact: true }),
  ).toBeFocused();
  await expect(input).toBeVisible();
});

test("Bot rows keep their density and conversation titles while search retains previews", async ({
  service,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(service.url);
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page.getByRole("menuitem", { name: "新建 Bot", exact: true }).click();
  let create = page.getByRole("dialog", { name: "新建 Bot", exact: true });
  await create
    .getByRole("textbox", { name: "名字", exact: true })
    .fill("研究助手");
  await create.getByRole("button", { name: "创建", exact: true }).click();
  const modelDialog = create;
  await modelDialog.getByRole("button", { name: "Pi", exact: true }).click();
  await modelDialog
    .getByRole("combobox", { name: "模型", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Pi · 测试模型一", exact: true })
    .click();
  await create.getByRole("button", { name: "开始聊天", exact: true }).click();
  await expect(create).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Bot详情", exact: true }),
  ).toContainText("研究助手");
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const details = page.getByRole("complementary", {
    name: "研究助手的详情",
    exact: true,
  });
  await details.getByRole("button", { name: "编辑", exact: true }).click();
  await details
    .getByRole("textbox", { name: "职责与长期指令" })
    .fill("整理研究资料");
  await details.getByRole("button", { name: "保存身份", exact: true }).click();
  await details.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page.getByRole("menuitem", { name: "新建 Bot", exact: true }).click();
  create = page.getByRole("dialog", { name: "新建 Bot", exact: true });
  const longName = "负责跨语言内容审校与排版的 Editorial Assistant";
  await create
    .getByRole("textbox", { name: "名字", exact: true })
    .fill(longName);
  await create.getByRole("button", { name: "创建", exact: true }).click();
  await modelDialog.getByRole("button", { name: "Pi", exact: true }).click();
  await modelDialog
    .getByRole("combobox", { name: "模型", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Pi · 测试模型一", exact: true })
    .click();
  await create.getByRole("button", { name: "开始聊天", exact: true }).click();
  await expect(create).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Bot详情", exact: true }),
  ).toContainText(longName);
  const contacts = page.getByRole("navigation", {
    name: "联系人",
    exact: true,
  });
  await expect(contacts.locator(".contact-row")).toHaveCount(3);
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
      (item) => item.height === geometry[0]?.height && item.lines === 1,
    ),
  ).toBe(true);
  expect(geometry[0]?.height).toBe(54);
  expect(geometry[0]?.nameWeight).toBe("500");
  const searchButton = page.getByRole("button", {
    name: "搜索联系人和聊天记录",
    exact: true,
  });
  await expect(page.locator(".sidebar-heading")).toHaveText("Bots");
  for (const button of await page.locator(".sidebar-toolbar > .button").all()) {
    await expect(button).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  }
  await searchButton.click();
  const dialog = page.getByRole("dialog", { name: "搜索", exact: true });
  const search = dialog.getByRole("searchbox");
  await expect(search).toBeFocused();
  const size = await dialog.boundingBox();
  await search.fill("开始对话");
  await expect(
    dialog.getByRole("region", { name: "Bot与团队" }).locator(".search-hit"),
  ).toHaveCount(2);
  await search.fill("整理研究资料");
  await expect(
    dialog.getByRole("button", { name: "研究助手", exact: true }),
  ).toBeVisible();
  expect(await dialog.boundingBox()).toEqual(size);
  await search.press("ArrowDown");
  await expect(
    dialog.getByRole("button", { name: "研究助手", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(search).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(searchButton).toBeFocused();
  const root = contacts.getByRole("link", { name: "Domos", exact: true });
  await root.click();
  await expect(
    page.getByRole("button", { name: "Bot详情", exact: true }),
  ).toContainText("Domos");
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill("核对列表预览");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.locator(".conversation-row-title").filter({ hasText: "核对列表预览" }),
  ).toHaveCount(1);
  await contacts.getByRole("link", { name: "研究助手", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Bot详情", exact: true }),
  ).toContainText("研究助手");
  await searchButton.click();
  await search.fill("已收到：核对列表预览");
  await expect(
    dialog.getByRole("button", { name: "Domos", exact: true }),
  ).toBeVisible();
  await search.clear();
  await dialog.getByRole("tab", { name: "聊天记录", exact: true }).click();
  await expect(dialog.getByText("输入关键词搜索聊天记录")).toBeVisible();
  await dialog.getByRole("tab", { name: "Bot与团队", exact: true }).click();
  await search.fill("Domos");
  await search.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(root).toHaveAttribute("aria-current", "page");
  await contacts.getByRole("link", { name: "研究助手", exact: true }).click();
  const active = contacts.getByRole("link", { name: "研究助手", exact: true });
  await page.mouse.move(400, 800);
  await expect(active).toHaveAttribute("aria-current", "page");
  await root.hover();
  await expect(root).not.toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(active).toHaveAttribute("aria-current", "page");
  await root.click();
  await expect(
    page.locator(".conversation-row-title").filter({ hasText: "核对列表预览" }),
  ).toHaveCount(1);
});

test("sidebar footer keeps two entries and opens the account menu above them", async ({
  service,
  page,
}, info) => {
  await page.goto(service.url);
  const footer = page.locator(".sidebar-footer");
  await expect(footer.getByRole("button")).toHaveCount(2);
  const account = footer.getByRole("button", { name: "用户菜单", exact: true });
  const connections = footer.getByRole("button", {
    name: "应用连接",
    exact: true,
  });
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await account.click();
    const menu = page.getByRole("menu");
    await expect(
      menu.getByRole("menuitem", { name: "设置", exact: true }),
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "用量", exact: true }),
    ).toBeVisible();
    const menuBox = await menu.boundingBox();
    const accountBox = await account.boundingBox();
    if (!menuBox || !accountBox) throw new Error("Menu geometry missing");
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(accountBox.y);
    await page.screenshot({
      path: info.outputPath(`account-menu-${theme}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(account).toBeFocused();
  }
  await account.press("ArrowUp");
  await page.getByRole("menuitem", { name: "用量", exact: true }).click();
  await expect(
    page.getByRole("main", { name: "用量", exact: true }),
  ).toBeVisible();
  await connections.click();
  await expect(
    page.getByRole("dialog", { name: "应用连接", exact: true }),
  ).toBeVisible();
});
