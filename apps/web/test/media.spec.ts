import { readFile, writeFile } from "node:fs/promises";
import { expect } from "@playwright/test";
import { png } from "../../../packages/agent/test/fixtures/png.ts";
import {
  attachFiles,
  chooseAppearance,
  composerFiles,
  expectTextContrast,
} from "./fixtures/chat-ui.ts";
import { test } from "./fixtures/service.ts";

test("attachment-only messages show cards directly for users and Bots", async ({
  service,
  page,
}) => {
  await page.goto(service.url);
  const transparent = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    canvas.getContext("2d")?.fillRect(80, 40, 160, 100);
    return canvas.toDataURL().split(",")[1];
  });
  await attachFiles(page, [
    {
      name: "photo.png",
      mimeType: "image/png",
      buffer: Buffer.from(transparent ?? "", "base64"),
    },
    {
      name: "report.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Report"),
    },
  ]);
  await expect(page.locator(".composer-attachments .attachment")).toHaveCount(
    2,
  );
  const files = await composerFiles(page);
  await service.control({
    responses: [
      {
        content: files.map((file) => ({
          type: "toolCall",
          id: crypto.randomUUID(),
          name: "attach_file",
          arguments: { path: file.path },
        })),
        stopReason: "toolUse",
      },
      { content: "资料已交付。" },
    ],
  });
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const outgoing = page.getByLabel("你的消息").last();
  const delivered = page.locator(".delivered-files");
  await expect(delivered).toHaveCount(1);
  for (const row of [outgoing, delivered]) {
    await expect(row.locator(".message-bubble")).toHaveCount(0);
    await expect(row.locator(".image-thumbnail")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await expect(
      row.getByRole("button", { name: "查看图片 photo.png", exact: true }),
    ).toBeVisible();
    await expect(
      row.getByRole("button", { name: "预览 report.txt", exact: true }),
    ).toBeVisible();
    await expect(
      row.getByRole("button", { name: /展开|收起/, exact: true }),
    ).toHaveCount(0);
  }
  for (const [theme, label] of [
    ["light", "浅色"],
    ["dark", "深色"],
  ] as const) {
    await chooseAppearance(page, label);
    await delivered.screenshot({
      path: `test-results/standalone-files-${theme}.png`,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page
          .locator(".transcript")
          .evaluate((node) => node.scrollWidth <= node.clientWidth),
      )
      .toBe(true);
    await page.setViewportSize({ width: 1360, height: 900 });
  }
});

test("audio decode failures preserve the file download action", async ({
  service,
  page,
}) => {
  await service.control({ content: "已收到音频。" });
  await page.goto(service.url);
  await page
    .locator("#bot-details")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  const audio = await readFile(
    new URL(
      "../../../packages/agent/test/fixtures/media/audio.mp3",
      import.meta.url,
    ),
  );
  await attachFiles(page, [
    {
      name: "broken.mp3",
      mimeType: "audio/mpeg",
      buffer: audio,
    },
  ]);
  await expect(page.locator(".composer-attachments .attachment")).toHaveCount(
    1,
  );
  await page.route(/\/files\/\d+\/[a-f0-9]{64}$/, (route) =>
    route.fulfill({ contentType: "audio/mpeg", body: "invalid audio" }),
  );
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const card = page.getByRole("group", {
    name: "音频 broken.mp3",
    exact: true,
  });
  await card
    .getByRole("button", { name: "播放 broken.mp3", exact: true })
    .click();
  await expect(card.getByRole("alert")).toContainText("音频无法播放");
  await expect(
    page.getByLabel("你的消息").last().locator(".message-bubble"),
  ).toHaveCount(0);
  await card
    .getByRole("button", { name: "更多文件操作 broken.mp3", exact: true })
    .click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "另存为…", exact: true }).click();
  const download = await downloaded;
  expect(await readFile(await download.path())).toEqual(audio);
  await page.unroute(/\/files\/\d+\/[a-f0-9]{64}$/);
  await card
    .getByRole("button", { name: "播放 broken.mp3", exact: true })
    .click();
  await expect
    .poll(() =>
      card
        .locator("audio")
        .evaluate((media: HTMLAudioElement) => media.currentTime),
    )
    .toBeGreaterThan(0.2);
  await expect(card.getByRole("alert")).toHaveCount(0);
  await card
    .getByRole("button", { name: "暂停 broken.mp3", exact: true })
    .click();
  const progress = card.getByRole("slider", { name: "播放进度 broken.mp3" });
  await progress.press("ArrowRight");
  await expect(progress).not.toHaveValue("0");
  await progress.evaluate((node) => node.blur());
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.mouse.move(0, 0);
    const colors = await card.evaluate((node) => {
      const sample = document.createElement("span");
      sample.style.cssText =
        "background:var(--color-surface);color:var(--color-muted)";
      node.append(sample);
      const style = getComputedStyle(sample);
      const colors = { background: style.backgroundColor, text: style.color };
      sample.remove();
      return colors;
    });
    await expect(card).toHaveCSS("background-color", colors.background);
    await expect(card.locator(".audio-play")).toHaveCSS("color", colors.text);
    await expectTextContrast(page);
    await page.setViewportSize({
      width: theme === "light" ? 1360 : 390,
      height: 844,
    });
    await expect(card.locator(".action-menu-trigger")).toHaveCSS(
      "position",
      "static",
    );
    expect(
      await card.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await page.evaluate(() => document.activeViewTransition?.finished);
    await card.evaluate((node) => node.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: `test-results/audio-pill-${theme}.png` });
  }
});

test("message media leads captions and bubble tails follow both themes", async ({
  service,
  page,
}) => {
  await service.control({ history: 40 });
  const imageReady = Promise.withResolvers<void>();
  await page.route(/\/files\/\d+\/[a-f0-9]{64}/, async (route) => {
    await imageReady.promise;
    await route.continue();
  });
  await service.control({ content: "图片和文档已收到。" });
  await page.goto(service.url);
  await expect(
    page.getByRole("button", { name: "添加内容", exact: true }),
  ).toBeEnabled();
  await attachFiles(page, [
    { name: "photo.png", mimeType: "image/png", buffer: png(320, 180) },
    {
      name: "report.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\n%%EOF\n"),
    },
  ]);
  await expect(page.locator(".composer-attachments .attachment")).toHaveCount(
    2,
  );
  await page.getByLabel("消息", { exact: true }).fill("请一起核对图片和文档。");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const incoming = page
    .getByLabel("Domos 的回复")
    .last()
    .locator(".message-bubble");
  const outgoing = page.getByLabel("你的消息").last();
  const outgoingBubble = outgoing.locator(".message-bubble");
  await expect(incoming).toContainText("图片和文档已收到。");
  await page.evaluate(() => document.activeViewTransition?.finished);
  const beforeImage = await incoming.boundingBox();
  imageReady.resolve();
  await expect(outgoing.locator("img")).toHaveJSProperty("naturalWidth", 320);
  await expect(async () => {
    const afterImage = await incoming.boundingBox();
    if (!beforeImage || !afterImage) throw new Error("Reply required");
    expect(Math.abs(afterImage.y - beforeImage.y)).toBeLessThanOrEqual(1);
  }).toPass();
  let lightBackground = "";
  for (const [theme, label] of [
    ["light", "浅色"],
    ["dark", "深色"],
  ] as const) {
    await page.setViewportSize({ width: 1360, height: 900 });
    await chooseAppearance(page, label);
    const background = await outgoingBubble.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    if (theme === "light") lightBackground = background;
    else expect(background).not.toBe(lightBackground);
    await expect(outgoingBubble).toHaveCSS(
      "color",
      theme === "light" ? "rgb(255, 255, 255)" : "rgb(245, 245, 245)",
    );
    await expectTextContrast(page);
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(async () => {
        const attachments = await outgoing
          .locator(".attachments")
          .boundingBox();
        const caption = await outgoing.locator(".user-text").boundingBox();
        const image = outgoing.locator(".image-thumbnail");
        await expect(image).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        await expect(outgoingBubble.locator(".attachments, img")).toHaveCount(
          0,
        );
        expect(
          attachments &&
            caption &&
            attachments.y + attachments.height <= caption.y,
        ).toBeTruthy();
      }).toPass({ timeout: 5000 });
      for (const bubble of [incoming, outgoingBubble]) {
        const tail = await bubble.evaluate((element) => {
          const style = getComputedStyle(element, "::after");
          return {
            shape: style.clipPath,
            color: style.backgroundColor,
            surface: getComputedStyle(element).backgroundColor,
          };
        });
        expect(tail.shape).not.toBe("none");
        expect(tail.color).toBe(tail.surface);
      }
      expect(
        await page
          .locator(".transcript")
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/message-bubbles-${theme}-${width}.png`,
      });
    }
  }
});

test("delivered images form a gallery with viewer downloads and keyboard navigation", async ({
  service,
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(service.url);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  const images = [
    { name: "wide.png", mimeType: "image/png", buffer: png(1024, 640) },
    { name: "portrait.png", mimeType: "image/png", buffer: png(360, 720) },
  ];
  await attachFiles(page, [
    ...images,
    {
      name: "report.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Report"),
    },
  ]);
  await expect(page.locator(".composer-attachments .attachment")).toHaveCount(
    3,
  );
  const files = await composerFiles(page);
  await service.control({
    responses: [
      {
        content: files.map((file) => ({
          type: "toolCall",
          id: crypto.randomUUID(),
          name: "attach_file",
          arguments: { path: file.path },
        })),
        stopReason: "toolUse",
      },
      { content: "图片与报告已交付。" },
    ],
  });
  await page.getByLabel("消息", { exact: true }).fill("交付图片和报告");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const delivered = page.locator(".delivered-files");
  await expect(delivered).toHaveCount(1);
  const gallery = delivered.getByRole("group", { name: "图片图库" });
  await expect(gallery.getByRole("img")).toHaveCount(2);
  await expect(delivered.locator(".file-attachment")).toHaveCount(1);
  await expect(gallery.getByRole("button", { name: /^下载/ })).toHaveCount(0);
  await expect(gallery.locator("time")).toHaveCount(0);
  await expect(
    delivered.getByRole("button", { name: "另存为 report.txt" }),
  ).toBeVisible();
  for (const label of ["深色", "浅色"]) {
    await chooseAppearance(page, label);
    await gallery.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/gallery-${label}.png` });
  }
  const thumbnail = gallery.getByRole("button", {
    name: "查看图片 wide.png",
    exact: true,
  });
  await thumbnail.click();
  const viewer = page.getByRole("dialog", { name: /^(wide|portrait)\.png$/ });
  await expect(
    viewer.getByRole("img", { name: "wide.png", exact: true }),
  ).toBeVisible();
  const viewport = page.viewportSize();
  await expect(viewer).toHaveCSS("scale", "1");
  const frame = await viewer.boundingBox();
  expect(frame).toMatchObject({
    x: 0,
    y: 0,
    width: viewport?.width,
    height: viewport?.height,
  });
  const thumbnails = viewer.getByRole("navigation", { name: "图片缩略图" });
  await expect(thumbnails.getByRole("button")).toHaveCount(2);
  const strip = viewer.locator(".image-viewer-strip .scroll-viewport");
  await expect(strip).toHaveCSS("scrollbar-width", "none");
  expect(
    await strip.evaluate((node) => node.scrollHeight <= node.clientHeight),
  ).toBe(true);
  await thumbnails
    .getByRole("button", { name: "查看图片 portrait.png", exact: true })
    .click();
  await expect(
    viewer.getByRole("img", { name: "portrait.png", exact: true }),
  ).toBeVisible();
  await expect(viewer.locator(".image-viewer-canvas")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await thumbnails
    .getByRole("button", { name: "查看图片 portrait.png", exact: true })
    .click();
  await expect(viewer.locator(".image-viewer-canvas")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await viewer.getByRole("button", { name: "旋转图片", exact: true }).click();
  await expect(viewer.locator(".image-viewer-canvas img")).toHaveCSS(
    "rotate",
    "90deg",
  );
  const rotated = await viewer
    .locator(".image-viewer-canvas img")
    .boundingBox();
  const stage = await viewer.locator(".image-viewer-stage").boundingBox();
  expect(
    rotated &&
      stage &&
      Math.abs(rotated.x + rotated.width / 2 - stage.x - stage.width / 2) < 1,
  ).toBe(true);
  expect(
    rotated &&
      stage &&
      Math.abs(rotated.y + rotated.height / 2 - stage.y - stage.height / 2) < 1,
  ).toBe(true);
  await viewer.getByRole("button", { name: "原始尺寸", exact: true }).click();
  await expect(
    viewer.getByRole("button", { name: "原始尺寸", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(viewer.locator(".image-viewer-canvas img")).toHaveCSS(
    "width",
    "360px",
  );
  await expect(viewer.locator(".image-viewer-canvas img")).toHaveCSS(
    "height",
    "720px",
  );
  await page.keyboard.press("ArrowRight");
  await expect(
    viewer.getByRole("img", { name: "wide.png", exact: true }),
  ).toBeVisible();
  await expect(viewer.locator(".image-viewer-canvas img")).toHaveCSS(
    "rotate",
    "0deg",
  );
  await expect(
    viewer.getByRole("button", { name: "原始尺寸", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("ArrowRight");
  await expect(
    viewer.getByRole("img", { name: "portrait.png", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      viewer.evaluate((element) => element.contains(document.activeElement)),
    )
    .toBe(true);
  await page.keyboard.press("ArrowLeft");
  await expect(
    viewer.getByRole("img", { name: "wide.png", exact: true }),
  ).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await viewer
    .getByRole("button", { name: "下载 wide.png", exact: true })
    .click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("wide.png");
  expect(await readFile(await download.path())).toEqual(images[0]?.buffer);
  await page.screenshot({ path: "test-results/gallery-viewer-desktop.png" });
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(thumbnail).toBeFocused();
  const sentThumbnail = page
    .getByLabel("你的消息", { exact: true })
    .getByRole("button", { name: "查看图片 wide.png", exact: true });
  for (const [width, height] of [
    [1440, 900],
    [768, 900],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    for (const label of ["深色", "浅色"]) {
      await chooseAppearance(page, label);
      await sentThumbnail.click();
      await expect(viewer.locator(".image-viewer-caption")).toHaveText(
        "交付图片和报告",
      );
      await expect(viewer).toBeVisible();
      await expect(viewer).toHaveCSS("scale", "1");
      await expect(viewer.locator(".image-viewer-canvas img")).toHaveCSS(
        "opacity",
        "1",
      );
      const close = await viewer
        .getByRole("button", { name: "关闭弹窗", exact: true })
        .boundingBox();
      expect(close && close.y >= 0).toBe(true);
      expect(
        await strip.evaluate((node) => node.scrollHeight <= node.clientHeight),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/image-viewer-${width}-${label}.png`,
      });
      await page.keyboard.press("Escape");
      await expect(sentThumbnail).toBeFocused();
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await thumbnail.click();
  await expect(viewer).toBeVisible();
  const bounds = await viewer.boundingBox();
  expect(
    bounds &&
      bounds.x >= 0 &&
      bounds.y >= 0 &&
      bounds.x + bounds.width <= 390 &&
      bounds.y + bounds.height <= 844,
  ).toBe(true);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: "test-results/gallery-viewer-mobile.png" });
  await viewer.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await page.reload();
  await expect(gallery.getByRole("img")).toHaveCount(2);
});

test("image thumbnails scroll horizontally and keep the selected image in view", async ({
  service,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(service.url);
  await attachFiles(
    page,
    Array.from({ length: 10 }, (_, index) => ({
      name: `photo-${index}.png`,
      mimeType: "image/png",
      buffer: png(100 + index, 80),
    })),
  );
  await expect(page.locator(".composer-attachments .attachment")).toHaveCount(
    10,
  );
  await page.getByLabel("消息", { exact: true }).fill("图片组");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page
    .getByLabel("你的消息", { exact: true })
    .getByRole("button", { name: "查看图片 photo-0.png", exact: true })
    .click();
  const viewer = page.getByRole("dialog", { name: /^photo-\d+\.png$/ });
  const strip = viewer.locator(".image-viewer-strip .scroll-viewport");
  await expect(strip).toHaveCSS("scrollbar-width", "none");
  expect(
    await strip.evaluate(
      (node) =>
        node.scrollWidth > node.clientWidth &&
        node.scrollHeight <= node.clientHeight,
    ),
  ).toBe(true);
  await expect
    .poll(() =>
      viewer.evaluate((element) => element.contains(document.activeElement)),
    )
    .toBe(true);
  await page.keyboard.press("ArrowLeft");
  const last = viewer.getByRole("button", {
    name: "查看图片 photo-9.png",
    exact: true,
  });
  await expect(last).toHaveAttribute("aria-current", "true");
  await expect(last).toBeInViewport();
  await expect
    .poll(() => strip.evaluate((node) => node.scrollLeft))
    .toBeGreaterThan(0);
  const track = viewer.locator('.scroll-bar[data-orientation="horizontal"]');
  await expect(track).toHaveCount(1);
  const trackBox = await track.boundingBox();
  const thumbBox = await track.locator(".scroll-thumb").boundingBox();
  expect(
    trackBox &&
      thumbBox &&
      thumbBox.x >= trackBox.x &&
      thumbBox.x + thumbBox.width <= trackBox.x + trackBox.width,
  ).toBe(true);
  await page.screenshot({ path: "test-results/image-viewer-strip-mobile.png" });
});

test("image viewer follows the live theme, displays original pixels and releases transitions", async ({
  service,
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(service.url);
  await chooseAppearance(page, "跟随系统");
  await page
    .locator("#bot-details")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  const name = "长文件名-原始图片-4096乘3072-验收.png";
  const fixture = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 4096;
    canvas.height = 3072;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas required");
    context.scale(4, 4);
    context.fillStyle = "#f5f2eb";
    context.fillRect(0, 0, 1024, 768);
    context.fillStyle = "#263b38";
    context.fillRect(64, 64, 896, 220);
    context.fillStyle = "#ffffff";
    context.font = "52px sans-serif";
    context.fillText("Domos / File preview", 104, 154);
    context.font = "24px sans-serif";
    context.fillText("4096 × 3072 · Original image", 104, 214);
    for (const [index, color] of ["#b6c9b6", "#dfbb94", "#9baebc"].entries()) {
      context.fillStyle = color;
      context.fillRect(64 + index * 306, 320, 284, 300);
    }
    context.fillStyle = "#263b38";
    context.font = "24px sans-serif";
    context.fillText("Fit to window / Original pixels / Rotate", 64, 690);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await attachFiles(page, {
    name,
    mimeType: "image/png",
    buffer: Buffer.from(fixture ?? "", "base64"),
  });
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const thumbnail = page
    .getByLabel("你的消息", { exact: true })
    .getByRole("button", { name: `查看图片 ${name}`, exact: true });
  await page.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function () {
      if (!this.closest(".image-viewer")) return decode.call(this);
      HTMLImageElement.prototype.decode = decode;
      return new Promise<void>((resolve, reject) => {
        this.dataset.decodePending = "true";
        this.addEventListener(
          "decode-image",
          () => void decode.call(this).then(resolve, reject),
          { once: true },
        );
      });
    };
  });
  await thumbnail.click();
  const viewer = page.getByRole("dialog", { name, exact: true });
  const image = viewer.locator(".image-viewer-canvas img");
  await expect(image).toHaveJSProperty("naturalWidth", 4096);
  await expect(image).toHaveCSS("opacity", "0");
  await expect(
    viewer.getByRole("status", { name: "正在加载图片…" }),
  ).toBeVisible();
  await expect(viewer.locator(".image-viewer-canvas")).toHaveCSS(
    "background-image",
    "none",
  );
  await expect(image).toHaveAttribute("data-decode-pending", "true");
  await image.dispatchEvent("decode-image");
  await expect(image).toHaveCSS("opacity", "1");
  await expect(viewer.getByRole("status")).toHaveCount(0);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      colorScheme,
    );
    const backdrop = page.locator(".image-viewer-backdrop");
    await expect(backdrop).toHaveCSS(
      "background-color",
      colorScheme === "light"
        ? "color(srgb 0.960784 0.960784 0.968627 / 0.88)"
        : "color(srgb 0.0823529 0.0823529 0.0901961 / 0.88)",
    );
    await expect(viewer).toHaveCSS(
      "color",
      colorScheme === "light" ? "rgb(32, 33, 35)" : "rgb(239, 239, 240)",
    );
    await expect(image).toHaveCSS("filter", "none");
    await expect(
      viewer.getByRole("navigation", { name: "图片缩略图" }),
    ).toHaveCount(0);
    const toolbar = await viewer
      .getByRole("toolbar", { name: "图片工具" })
      .boundingBox();
    const stage = await viewer.locator(".image-viewer-stage").boundingBox();
    expect(toolbar && stage && toolbar.y >= stage.y + stage.height).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`image-single-${colorScheme}.png`),
      animations: "disabled",
    });
  }
  await viewer.getByRole("button", { name: "原始尺寸", exact: true }).click();
  await expect(image).toHaveCSS("width", "4096px");
  await expect(image).toHaveCSS("height", "3072px");
  expect(
    await viewer
      .locator(".image-viewer-stage")
      .evaluate(
        (node) =>
          node.scrollWidth > node.clientWidth &&
          node.scrollHeight > node.clientHeight,
      ),
  ).toBe(true);
  await viewer.getByRole("button", { name: "适应窗口", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 760 });
  expect(
    await viewer
      .locator(".image-viewer-stage")
      .evaluate(
        (node) =>
          node.scrollWidth <= node.clientWidth &&
          node.scrollHeight <= node.clientHeight,
      ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("image-single-narrow.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(thumbnail).toBeFocused();
  const interrupted = await thumbnail.evaluate(
    async (button: HTMLButtonElement) => {
      button.click();
      return new Promise<{ before: number; after: number; retained: boolean }>(
        (resolve) => {
          const frame = () => {
            const popup = document.querySelector<HTMLElement>(".image-viewer");
            const before = popup ? Number(getComputedStyle(popup).opacity) : 0;
            if (!popup || before <= 0) return void requestAnimationFrame(frame);
            popup.dispatchEvent(
              new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
            );
            requestAnimationFrame(() => {
              resolve({
                before,
                after: Number(getComputedStyle(popup).opacity),
                retained: Boolean(popup.querySelector("img")),
              });
            });
          };
          requestAnimationFrame(frame);
        },
      );
    },
  );
  expect(interrupted.before).toBeLessThan(1);
  expect(interrupted.after).toBeLessThanOrEqual(interrupted.before + 0.01);
  expect(interrupted.retained).toBe(true);
  await expect(viewer).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await thumbnail.click();
  await expect(image).toHaveCSS("opacity", "1");
  expect(await viewer.evaluate((node) => node.getAnimations().length)).toBe(0);
  expect(await image.evaluate((node) => node.getAnimations().length)).toBe(0);
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const measurements = [];
  for (let run = 0; run < 5; run++) {
    const measurement = await thumbnail.evaluate(
      async (button: HTMLButtonElement) => {
        const start = performance.now();
        const frames: number[] = [];
        const duration = Number.parseFloat(
          getComputedStyle(button).getPropertyValue("--motion-message-in"),
        );
        let previous = start;
        let ready = 0;
        let animatedFrames = 0;
        button.click();
        await new Promise<void>((resolve) => {
          const frame = (now: number) => {
            frames.push(now - previous);
            previous = now;
            const image = document.querySelector<HTMLImageElement>(
              ".image-viewer-canvas img",
            );
            if (image?.parentElement?.dataset.ready === "true" && !ready)
              ready = performance.now() - start;
            const running = document
              .querySelector(".image-viewer")
              ?.getAnimations({ subtree: true })
              .some((animation) => animation.playState === "running");
            if (running) animatedFrames++;
            if (ready && now - start >= ready + duration && !running) resolve();
            else requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        });
        return { ready, frames, animatedFrames };
      },
    );
    measurements.push(measurement);
    expect(measurement.ready).toBeLessThan(1000);
    expect(measurement.animatedFrames).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);
    await expect(thumbnail).toBeFocused();
  }
  const frames = measurements
    .flatMap((measurement) => measurement.frames)
    .sort((a, b) => a - b);
  const p95 = frames[Math.floor(frames.length * 0.95)] ?? 0;
  expect(p95).toBeLessThan(100);
  const performancePath = testInfo.outputPath("image-viewer-performance.json");
  await writeFile(
    performancePath,
    JSON.stringify(
      {
        image: "4096x3072",
        browser: "Chromium",
        viewport: page.viewportSize(),
        measurements,
        frameIntervalP95: p95,
      },
      null,
      2,
    ),
  );
  await testInfo.attach("image-viewer-performance", {
    path: performancePath,
    contentType: "application/json",
  });
  await page.route("**/files/*/*", (route) => route.abort());
  await page.reload();
  await thumbnail.click();
  await expect(
    viewer.getByText("图片暂时无法加载，可下载原图。", { exact: true }),
  ).toBeVisible();
  await expect(
    viewer.getByRole("button", { name: "原始尺寸", exact: true }),
  ).toBeDisabled();
  await expect(
    viewer.getByRole("button", { name: `下载 ${name}`, exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("image-unavailable.png") });
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  expect(errors).toEqual([]);
});
