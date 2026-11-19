import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { pdf } from "../../../packages/agent/test/fixtures/pdf.ts";
import { png } from "../../../packages/agent/test/fixtures/png.ts";
import { composerFiles } from "../../web/test/fixtures/chat-ui.ts";
import { workspacePage } from "./pages.ts";

test("desktop uploads, previews, searches and downloads saved files", async ({
  playwright,
}, testInfo) => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), "domos-desktop-files-"));
  const worker = fork(
    fileURLToPath(
      new URL("../../api/test/fixtures/web-server.ts", import.meta.url),
    ),
    [join(directory, "agent.sqlite"), "0", "hosting"],
    { silent: true, execArgv: [] },
  );
  worker.stdout?.resume();
  worker.stderr?.resume();
  const [ready] = (await once(worker, "message")) as [
    { port: number; pairing: string },
  ];
  const executablePath = createRequire(
    new URL("../package.json", import.meta.url),
  )("electron") as string;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.PATH = directory;
  const profile = join(directory, "profile");
  await mkdir(profile);
  const desktop = await playwright._electron.launch({
    executablePath,
    args: [
      fileURLToPath(new URL("./entry.mjs", import.meta.url)),
      `--test-data-dir=${profile}`,
    ],
    env,
  });
  try {
    const setup = await desktop.firstWindow();
    await setup
      .getByRole("button", { name: "连接另一台电脑", exact: true })
      .click();
    await expect(setup.locator(".startup-viewport")).not.toHaveAttribute(
      "data-travelling",
      "",
    );
    await setup.getByLabel("Domos 地址").fill(`http://127.0.0.1:${ready.port}`);

    await setup.getByRole("button", { name: "连接", exact: true }).click();
    const page = await workspacePage(desktop);
    await page.getByLabel("配对码", { exact: true }).fill(ready.pairing);
    await page.getByRole("button", { name: "连接", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Bot详情", exact: true }),
    ).toBeVisible();
    await page
      .locator("#bot-details")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page.getByRole("button", { name: "添加内容", exact: true }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "添加文件", exact: true }).click();
    const fixture = async (folder: string, name: string, mimeType: string) => ({
      name,
      mimeType,
      buffer: await readFile(
        new URL(
          `../../../packages/agent/test/fixtures/${folder}/${name}`,
          import.meta.url,
        ),
      ),
    });
    await (await chooser).setFiles([
      { name: "阅读.pdf", mimeType: "application/pdf", buffer: pdf() },
      {
        name: "说明.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("# 桌面文件预览\n\n**中文内容**"),
      },
      {
        name: "数据.csv",
        mimeType: "text/csv",
        buffer: Buffer.from('name,value\n"a,b",001'),
      },
      {
        name: "交互.html",
        mimeType: "text/html",
        buffer: Buffer.from(
          "<button onclick=\"this.textContent='已计算'\">计算</button>",
        ),
      },
      await fixture(
        "office",
        "data.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
      await fixture(
        "office",
        "report.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
      await fixture(
        "office",
        "slides.pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ),
      await fixture("media", "audio.mp3", "audio/mpeg"),
      await fixture("media", "video.mp4", "video/mp4"),
      await fixture("media", "video.mov", "video/quicktime"),
    ]);
    await expect(page.locator(".composer-attachments .attachment")).toHaveCount(
      10,
    );
    const sharedAudio = (await composerFiles(page)).find(
      (file) => file.name === "audio.mp3",
    );
    await page
      .getByRole("textbox", { name: "消息", exact: true })
      .fill("桌面验收");
    const scripted = once(worker, "message");
    worker.send({
      content: "文件已保存。可以直接查看表格、阅读文档，或播放音视频。",
    });
    await scripted;
    const previewRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith("/preview"))
        previewRequests.push(request.url());
    });
    await page.getByRole("button", { name: "发送", exact: true }).click();
    const pdfCard = page.locator(".message-attachment").filter({
      has: page.getByRole("button", { name: "预览 阅读.pdf", exact: true }),
    });
    await desktop.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(
        (item) => !item.isDestroyed(),
      );
      window?.restore();
      window?.show();
      window?.focus();
    });
    await page.bringToFront();
    await expect(page.locator("body")).toBeVisible();
    await pdfCard.scrollIntoViewIfNeeded();
    await expect(pdfCard.locator(".file-card-thumbnail img")).toBeVisible({
      timeout: 30_000,
    });
    await expect(pdfCard).toContainText("2 页");
    for (const name of ["audio.mp3", "video.mp4", "video.mov"]) {
      const card =
        name === "audio.mp3"
          ? page.getByRole("group", { name: `音频 ${name}`, exact: true })
          : page.locator(".media-attachment").filter({
              has: page.getByRole("button", {
                name: `预览 ${name}`,
                exact: true,
              }),
            });
      await card.scrollIntoViewIfNeeded();
      await expect(card.locator(".media-attachment-duration")).toHaveText(
        "0:03",
      );
      await expect(card.locator(".file-card-actions")).toHaveCount(0);
      if (name !== "audio.mp3") {
        await expect(card.locator("img")).toBeVisible();
        expect(
          await card
            .locator("img")
            .evaluate((image: HTMLImageElement) => image.naturalWidth),
        ).toBeGreaterThan(0);
      } else {
        await expect(card.locator("audio")).not.toHaveAttribute("src");
        await card
          .getByRole("button", { name: "播放 audio.mp3", exact: true })
          .click();
        await expect
          .poll(() =>
            card
              .locator("audio")
              .evaluate((media: HTMLAudioElement) => media.currentTime),
          )
          .toBeGreaterThan(0.2);
        await expect
          .poll(() =>
            card
              .locator(".audio-waveform g rect")
              .evaluateAll((bars) =>
                Math.max(
                  ...bars.map((bar) => Number(bar.getAttribute("height"))),
                ),
              ),
          )
          .toBeGreaterThan(2);
        await card
          .getByRole("button", { name: "暂停 audio.mp3", exact: true })
          .click();
        const seek = card.getByRole("slider", {
          name: "播放进度 audio.mp3",
          exact: true,
        });
        await seek.focus();
        await seek.press("End");
        await seek.press("ArrowLeft");
        await expect
          .poll(() =>
            card
              .locator("audio")
              .evaluate((media: HTMLAudioElement) => media.currentTime),
          )
          .toBeGreaterThan(1);
      }
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await page.evaluate(() =>
          (document.activeElement as HTMLElement)?.blur(),
        );
        await card.screenshot({
          path: testInfo.outputPath(`message-${name}-${theme}.png`),
        });
      }
    }
    await expect(
      page.locator(".attachments video, .attachments audio[src]"),
    ).toHaveCount(1);
    expect(previewRequests).toEqual([]);
    await page.emulateMedia({ colorScheme: "light" });
    const panel = page.getByRole("complementary", {
      name: "文件预览",
      exact: true,
    });
    for (const [name, text] of [
      ["阅读.pdf", "PDF page one"],
      ["说明.md", "桌面文件预览"],
      ["数据.csv", "001"],
    ]) {
      await page
        .getByRole("button", { name: `预览 ${name}`, exact: true })
        .click();
      await expect(panel).toContainText(text ?? "");
      if (name === "阅读.pdf") {
        await expect(panel.locator("canvas").first()).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath("file-pdf.png") });
        await page.emulateMedia({ colorScheme: "dark" });
        await expect(page.locator("html")).toHaveAttribute(
          "data-theme",
          "dark",
        );
        await page.screenshot({
          path: testInfo.outputPath("file-pdf-dark.png"),
        });
        await page.emulateMedia({ colorScheme: "light" });
        const path = join(directory, "download.pdf");
        await writeFile(path, "previous content");
        await desktop.evaluate(({ dialog }, target) => {
          dialog.showSaveDialog = async () => ({
            canceled: false,
            filePath: target,
          });
        }, path);
        await panel
          .getByRole("button", { name: "下载文件", exact: true })
          .click();
        await expect
          .poll(() =>
            readFile(path).then(
              (bytes) => bytes.equals(pdf()),
              () => false,
            ),
          )
          .toBe(true);
        await desktop.evaluate(({ dialog }) => {
          dialog.showSaveDialog = async () => ({
            canceled: true,
            filePath: "",
          });
        });
        await panel
          .getByRole("button", { name: "下载文件", exact: true })
          .click();
        await expect(
          panel.getByRole("button", { name: "下载文件", exact: true }),
        ).toBeEnabled();
        expect(
          await page.evaluate(() =>
            window.domosDesktop?.file({
              action: "open",
              botId: 1,
              id: "../../outside",
            }),
          ),
        ).toMatchObject({ ok: false });
        await desktop.evaluate(({ shell }) => {
          Reflect.set(globalThis, "fileActionPaths", []);
          shell.openPath = async (path) => {
            Reflect.get(globalThis, "fileActionPaths").push(path);
            return "";
          };
          shell.showItemInFolder = (path) => {
            Reflect.get(globalThis, "fileActionPaths").push(path);
          };
        });
        await panel
          .getByRole("button", { name: "文件操作", exact: true })
          .click();
        await page.screenshot({
          path: testInfo.outputPath("file-actions-menu.png"),
        });
        await page
          .getByRole("menuitem", { name: "系统打开本地副本", exact: true })
          .click();
        await expect
          .poll(() =>
            desktop.evaluate(
              () => Reflect.get(globalThis, "fileActionPaths").length,
            ),
          )
          .toBe(1);
        const local = await desktop.evaluate(
          () => Reflect.get(globalThis, "fileActionPaths")[0] as string,
        );
        expect(await readFile(local)).toEqual(pdf());
        await panel
          .getByRole("button", { name: "文件操作", exact: true })
          .click();
        await page
          .getByRole("menuitem", { name: "显示本地副本位置", exact: true })
          .click();
        await expect
          .poll(() =>
            desktop.evaluate(
              () => Reflect.get(globalThis, "fileActionPaths").length,
            ),
          )
          .toBe(2);
        await desktop.evaluate(({ shell }) => {
          shell.openPath = async () => "没有关联应用";
        });
        await panel
          .getByRole("button", { name: "文件操作", exact: true })
          .click();
        await page
          .getByRole("menuitem", { name: "系统打开本地副本", exact: true })
          .click();
        await expect(panel.getByRole("alert")).toContainText("没有关联应用");
        await page.screenshot({
          path: testInfo.outputPath("desktop-files-light.png"),
        });
      }
      await panel.getByRole("button", { name: "关闭", exact: true }).click();
    }
    const mediaEvents: unknown[] = [];
    const diagnostics = await page.context().newCDPSession(page);
    await diagnostics.send("Media.enable");
    diagnostics.on("Media.playerPropertiesChanged", (event) =>
      mediaEvents.push(event),
    );
    const measurements: Record<string, unknown> = {};
    const seekTimes: number[] = [];
    for (const name of [
      "data.xlsx",
      "report.docx",
      "slides.pptx",
      "audio.mp3",
      "video.mp4",
      "video.mov",
    ]) {
      const reads = previewRequests.length;
      const openedAt = performance.now();
      if (name === "audio.mp3") {
        await page
          .getByRole("button", { name: "更多文件操作 audio.mp3", exact: true })
          .click();
        await page
          .getByRole("menuitem", { name: "查看详情", exact: true })
          .click();
      } else {
        await page
          .getByRole("button", { name: `预览 ${name}`, exact: true })
          .click();
      }
      if (name.endsWith("xlsx")) {
        await expect(
          panel.getByRole("cell", { name: "123.45", exact: true }),
        ).toBeVisible();
        await panel.getByRole("button", { name: "明细", exact: true }).click();
        await expect(panel).toContainText("第二张表");
      } else if (/\.(docx|pptx)$/.test(name)) {
        await expect(panel).toContainText(
          "此格式暂不支持预览，请下载后使用本机应用打开。",
        );
        expect(previewRequests).toHaveLength(reads);
        const target = join(directory, name);
        await desktop.evaluate(({ dialog, shell }, path) => {
          dialog.showSaveDialog = async () => ({
            canceled: false,
            filePath: path,
          });
          shell.openPath = async (local) => {
            Reflect.get(globalThis, "fileActionPaths").push(local);
            return "";
          };
        }, target);
        await panel
          .getByRole("button", { name: "下载文件", exact: true })
          .click();
        const original = (await fixture("office", name, "")).buffer;
        await expect
          .poll(() =>
            readFile(target).then(
              (bytes) => bytes.equals(original),
              () => false,
            ),
          )
          .toBe(true);
        await panel
          .getByRole("button", { name: "文件操作", exact: true })
          .click();
        const operations = await desktop.evaluate(
          () => Reflect.get(globalThis, "fileActionPaths").length as number,
        );
        await page
          .getByRole("menuitem", { name: "系统打开本地副本", exact: true })
          .click();
        await expect
          .poll(() =>
            desktop.evaluate(
              () => Reflect.get(globalThis, "fileActionPaths").length,
            ),
          )
          .toBe(operations + 1);
        const local = await desktop.evaluate(
          () => Reflect.get(globalThis, "fileActionPaths").at(-1) as string,
        );
        expect(await readFile(local)).toEqual(original);
      } else {
        const media = panel.locator("audio, video");
        await expect
          .poll(() =>
            media.evaluate((element: HTMLMediaElement) => element.readyState),
          )
          .toBeGreaterThanOrEqual(2);
        await media.evaluate((element: HTMLMediaElement) => element.play());
        await expect
          .poll(() =>
            media.evaluate((element: HTMLMediaElement) => element.currentTime),
          )
          .toBeGreaterThan(0.3);
        await media.evaluate((element: HTMLMediaElement) => {
          element.currentTime = 1.5;
        });
        await expect
          .poll(() =>
            media.evaluate((element: HTMLMediaElement) => element.seeking),
          )
          .toBe(false);
        expect(
          await media.evaluate((element: HTMLMediaElement) => element.error),
        ).toBeNull();
        measurements[name] ??= { firstPreviewMs: performance.now() - openedAt };
        if (name === "video.mp4") {
          for (let sample = 0; sample < 30; sample++) {
            const started = performance.now();
            await media.evaluate(
              (element: HTMLVideoElement, target) =>
                new Promise<void>((resolve) => {
                  element.addEventListener(
                    "seeked",
                    () => element.requestVideoFrameCallback(() => resolve()),
                    { once: true },
                  );
                  element.currentTime = target;
                }),
              sample % 2 ? 1.5 : 0.2,
            );
            seekTimes.push(performance.now() - started);
          }
          measurements.video = await media.evaluate(
            (element: HTMLVideoElement) => {
              const quality = element.getVideoPlaybackQuality();
              return {
                width: element.videoWidth,
                height: element.videoHeight,
                totalFrames: quality.totalVideoFrames,
                droppedFrames: quality.droppedVideoFrames,
              };
            },
          );
        }
      }
      measurements[name] ??= { firstPreviewMs: performance.now() - openedAt };
      await page.screenshot({ path: testInfo.outputPath(`file-${name}.png`) });
      await page.emulateMedia({ colorScheme: "dark" });
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await page.screenshot({
        path: testInfo.outputPath(`file-${name}-dark.png`),
      });
      await page.emulateMedia({ colorScheme: "light" });
      await panel.getByRole("button", { name: "关闭", exact: true }).click();
    }
    await page
      .locator(".file-card")
      .first()
      .screenshot({ path: testInfo.outputPath("file-message-cards.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page
      .locator(".file-card")
      .first()
      .screenshot({ path: testInfo.outputPath("file-message-cards-dark.png") });
    await page.emulateMedia({ colorScheme: "light" });
    const sorted = seekTimes.toSorted((a, b) => a - b);
    measurements.mediaEvents = mediaEvents;
    measurements.seek = {
      samplesMs: seekTimes,
      p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
      p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    };
    measurements.runtime = await desktop.evaluate(({ app }) => ({
      versions: process.versions,
      processes: app.getAppMetrics(),
      gpu: app.getGPUFeatureStatus(),
    }));
    const performancePath = testInfo.outputPath("file-performance.json");
    await writeFile(performancePath, JSON.stringify(measurements, null, 2));
    await testInfo.attach("file-performance.json", {
      path: performancePath,
      contentType: "application/json",
    });

    await page.getByRole("button", { name: "添加内容", exact: true }).click();
    const unsupported = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "添加文件", exact: true }).click();
    await (await unsupported).setFiles([
      await fixture("media", "prores.mov", "video/quicktime"),
    ]);
    await expect(page.locator(".composer-attachments .attachment")).toHaveCount(
      1,
    );
    await page
      .getByRole("textbox", { name: "消息", exact: true })
      .fill("检查不支持的编码");
    await expect(
      page.getByRole("button", { name: "发送", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page
      .getByRole("button", { name: "预览 prores.mov", exact: true })
      .click();
    await panel
      .locator("video")
      .evaluate((video: HTMLVideoElement) => video.play().catch(() => {}));
    await expect(panel.getByRole("alert")).toContainText("编码无法");
    await expect(
      panel.getByRole("button", { name: "下载文件", exact: true }),
    ).toBeEnabled();
    await page.screenshot({
      path: testInfo.outputPath("file-unsupported-codec.png"),
    });
    await panel.getByRole("button", { name: "关闭", exact: true }).click();
    for (const notice of await page
      .getByRole("button", { name: "关闭提醒", exact: true })
      .all())
      await notice.click();
    await page
      .getByRole("button", { name: "预览 交互.html", exact: true })
      .click();
    const content = panel.frameLocator("iframe").frameLocator("iframe");
    await content.getByRole("button", { name: "计算", exact: true }).click();
    await expect(
      content.getByRole("button", { name: "已计算", exact: true }),
    ).toBeVisible();
    expect(
      await content
        .locator("body")
        .evaluate(() => typeof Reflect.get(window, "domosDesktop")),
    ).toBe("undefined");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(content.locator("body")).toHaveCSS(
      "background-color",
      "rgb(12, 12, 13)",
    );
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(480, 720),
    );
    await expect(panel).toBeInViewport();
    expect(
      (await panel.locator("iframe").boundingBox())?.height,
    ).toBeGreaterThan(400);
    expect(
      await panel.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("desktop-files-dark-narrow.png"),
    });
    await panel.getByRole("button", { name: "返回", exact: true }).click();
    await page
      .getByRole("searchbox", { name: "搜索文件", exact: true })
      .fill("说明");
    await expect(page.locator(".file-list-row")).toHaveCount(1);
    await page
      .locator(".file-list")
      .getByRole("button", { name: "更多文件操作 说明.md", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "在聊天中查看", exact: true })
      .click();
    await expect(
      page
        .getByRole("log", { name: "聊天记录", exact: true })
        .getByRole("button", { name: "预览 说明.md", exact: true }),
    ).toBeInViewport();
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(1360, 900),
    );
    const delivery = once(worker, "message");
    worker.send({
      responses: [
        {
          content: [
            {
              type: "toolCall",
              id: crypto.randomUUID(),
              name: "attach_file",
              arguments: { path: sharedAudio?.path },
            },
          ],
          stopReason: "toolUse",
        },
        { content: "这是音频，点击即可试听。" },
      ],
    });
    await delivery;
    await page
      .getByRole("textbox", { name: "消息", exact: true })
      .fill("请回传音频");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    const receivedAudio = page
      .locator(".delivered-files")
      .getByRole("group", { name: "音频 audio.mp3", exact: true });
    await expect(receivedAudio.locator(".bot-avatar")).toBeVisible();
    await expect(page.locator(".delivered-files .message-bubble")).toHaveCount(
      0,
    );
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await receivedAudio.scrollIntoViewIfNeeded();
      await receivedAudio
        .getByRole("button", { name: "播放 audio.mp3", exact: true })
        .click();
      await expect
        .poll(() =>
          receivedAudio
            .locator("audio")
            .evaluate((media: HTMLAudioElement) => media.currentTime),
        )
        .toBeGreaterThan(1);
      await receivedAudio
        .getByRole("button", { name: "暂停 audio.mp3", exact: true })
        .click();
      await page.evaluate(() =>
        (document.activeElement as HTMLElement)?.blur(),
      );
      await receivedAudio.screenshot({
        path: testInfo.outputPath(`message-audio-incoming-${theme}.png`),
      });
    }
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(480, 720),
    );
    await expect(page.locator(".workspace")).toHaveAttribute("data-mobile");
    await expect(page.locator(".panel-backdrop:visible")).toHaveCount(0);
    await receivedAudio.scrollIntoViewIfNeeded();
    expect(
      await page
        .locator(".transcript")
        .evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await receivedAudio.screenshot({
      path: testInfo.outputPath("message-audio-narrow.png"),
    });
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(1360, 900),
    );
    await receivedAudio
      .getByRole("button", { name: "播放 audio.mp3", exact: true })
      .click();
    const activeAudio = await receivedAudio.locator("audio").elementHandle();
    await page.getByRole("button", { name: "用户菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: "用量", exact: true }).click();
    await expect(receivedAudio).toHaveCount(0);
    expect(
      await activeAudio?.evaluate((media: HTMLAudioElement) => ({
        paused: media.paused,
        src: media.getAttribute("src"),
      })),
    ).toEqual({ paused: true, src: null });
    await page.getByRole("button", { name: "用户菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: "用量", exact: true }).click();
    await page.getByRole("button", { name: "添加内容", exact: true }).click();
    const imageChooser = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "添加文件", exact: true }).click();
    await (await imageChooser).setFiles({
      name: "desktop-image.png",
      mimeType: "image/png",
      buffer: png(2048, 1536),
    });
    await page.getByRole("button", { name: "发送", exact: true }).click();
    const imageThumbnail = page
      .getByLabel("你的消息", { exact: true })
      .getByRole("button", { name: "查看图片 desktop-image.png", exact: true });
    await imageThumbnail.click();
    const imageViewer = page.getByRole("dialog", {
      name: "desktop-image.png",
      exact: true,
    });
    await expect(
      imageViewer.locator(".image-viewer-canvas img"),
    ).toHaveJSProperty("naturalWidth", 2048);
    await expect(imageViewer).toHaveCSS("scale", "1");
    const frame = await imageViewer.boundingBox();
    expect(frame?.y).toBe(0);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        colorScheme,
      );
      await page.screenshot({
        path: testInfo.outputPath(`desktop-image-${colorScheme}.png`),
        animations: "disabled",
      });
    }
    await imageViewer
      .getByRole("button", { name: "原始尺寸", exact: true })
      .click();
    await expect(imageViewer.locator(".image-viewer-canvas img")).toHaveCSS(
      "width",
      "2048px",
    );
    await page.keyboard.press("Escape");
    await expect(imageViewer).toHaveCount(0);
    await expect(imageThumbnail).toBeFocused();
  } finally {
    await desktop.close();
    const exited = once(worker, "exit");
    worker.kill("SIGKILL");
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
