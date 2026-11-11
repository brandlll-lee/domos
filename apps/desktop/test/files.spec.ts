import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { pdf } from "../../../packages/agent/test/fixtures/pdf.ts";

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
    await setup.getByLabel("Domos 地址").fill(`http://127.0.0.1:${ready.port}`);
    const opened = desktop.waitForEvent("window");
    await setup.getByRole("button", { name: "连接", exact: true }).click();
    const page = await opened;
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
    await page
      .getByRole("textbox", { name: "消息", exact: true })
      .fill("桌面验收");
    const scripted = once(worker, "message");
    worker.send({
      content: "文件已保存。可以直接查看表格、阅读文档，或播放音视频。",
    });
    await scripted;
    await page.getByRole("button", { name: "发送", exact: true }).click();
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
          .getByRole("button", { name: "系统打开", exact: true })
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
          .getByRole("button", { name: "文件位置", exact: true })
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
          .getByRole("button", { name: "系统打开", exact: true })
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
      let releasePreview: (() => void) | undefined;
      if (name === "report.docx") {
        const gate = new Promise<void>((resolve) => {
          releasePreview = resolve;
        });
        await page.route(
          "**/files/*/*/preview",
          async (route) => {
            await gate;
            await route.continue();
          },
          { times: 1 },
        );
      }
      const openedAt = performance.now();
      await page
        .getByRole("button", { name: `预览 ${name}`, exact: true })
        .click();
      if (releasePreview) {
        await expect(
          panel.getByRole("status", { name: "正在生成文档预览" }),
        ).toBeVisible();
        await page.screenshot({
          path: testInfo.outputPath("file-converting.png"),
        });
        releasePreview();
      }
      if (name.endsWith("xlsx")) {
        await expect(
          panel.getByRole("cell", { name: "123.45", exact: true }),
        ).toBeVisible();
        await panel.getByRole("button", { name: "明细", exact: true }).click();
        await expect(panel).toContainText("第二张表");
      } else if (/\.(docx|pptx)$/.test(name)) {
        await expect(panel.locator("canvas").first()).toBeVisible({
          timeout: 30_000,
        });
        await expect(panel).toContainText("LibreOffice");
        await expect(panel).toContainText(
          name === "report.docx" ? "Domos Word preview" : "Domos slide 1",
        );
        await expect(panel).toContainText(
          name === "report.docx" ? "中文预览" : "中文幻灯片预览",
        );
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
    await page.route(
      "**/files/*/*/preview",
      (route) =>
        route.fulfill({
          status: 422,
          body: "文档转换失败。你仍可下载原文件。",
        }),
      { times: 1 },
    );
    await page.getByRole("button", { name: "添加内容", exact: true }).click();
    const conversion = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "添加文件", exact: true }).click();
    await (await conversion).setFiles([
      {
        ...(await fixture(
          "office",
          "report.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )),
        name: "conversion.docx",
      },
    ]);
    await expect(page.locator(".composer-attachments .attachment")).toHaveCount(
      1,
    );
    await page
      .getByRole("textbox", { name: "消息", exact: true })
      .fill("查看新文档");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page
      .getByRole("button", { name: "预览 conversion.docx", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toContainText("文档转换失败");
    await page.screenshot({
      path: testInfo.outputPath("file-conversion-error.png"),
    });
    await panel.getByRole("button", { name: "重试", exact: true }).click();
    await expect(panel.locator("canvas").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(panel).toContainText("Domos Word preview");
    await panel.getByRole("button", { name: "关闭", exact: true }).click();
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
    await expect(panel.getByRole("alert")).toContainText("编码无法");
    await expect(
      panel.getByRole("button", { name: "下载文件", exact: true }),
    ).toBeEnabled();
    await page.screenshot({
      path: testInfo.outputPath("file-unsupported-codec.png"),
    });
    await panel.getByRole("button", { name: "关闭", exact: true }).click();
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
      .getByRole("button", { name: "在聊天中查看", exact: true })
      .click();
    await expect(
      page
        .getByRole("log", { name: "聊天记录", exact: true })
        .getByRole("button", { name: "预览 说明.md", exact: true }),
    ).toBeInViewport();
  } finally {
    await desktop.close();
    const exited = once(worker, "exit");
    worker.kill("SIGKILL");
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
