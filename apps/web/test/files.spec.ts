import { readFile, writeFile } from "node:fs/promises";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { expect } from "@playwright/test";
import { pdf } from "../../../packages/agent/test/fixtures/pdf.ts";
import { png } from "../../../packages/agent/test/fixtures/png.ts";
import type { AppRouter } from "../../api/src/router.ts";
import {
  attachFiles,
  chooseAppearance,
  createBot,
  expectTextContrast,
  openDetails,
} from "./fixtures/chat-ui.ts";
import { test } from "./fixtures/service.ts";

test("files preview documents, search old history and return to the source", async ({
  service,
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const client: RouterClient<AppRouter> = createORPCClient(
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  const bot = (await client.bots.list())[0];
  if (!bot) throw new Error("Bot required");
  const documents = [
    new File(["# 文件预览验收\n\n**中文文档**"], "说明.md"),
    new File(['name,value\n"one,two",001\n"multi\nline",002'], "数据.csv"),
    new File(["const greeting = '你好';"], "代码.ts"),
    new File(["%PDF-1.7\ninvalid"], "损坏.pdf"),
    new File([new Uint8Array([0, 255, 0])], "文件.bin"),
    new File([png(320, 240)], "照片.png"),
    new File(
      [
        await readFile(
          new URL(
            "../../../packages/agent/test/fixtures/media/audio.mp3",
            import.meta.url,
          ),
        ),
      ],
      "语音.mp3",
    ),
    new File(
      [
        await readFile(
          new URL(
            "../../../packages/agent/test/fixtures/media/video.mp4",
            import.meta.url,
          ),
        ),
      ],
      "录像.mp4",
    ),
  ];
  const attachments = [];
  for (const file of documents)
    attachments.push(await client.files.upload({ botId: bot.id, file }));
  await service.control({ content: "已完成。" });
  await client.send({
    botId: bot.id,
    text: "文件验收",
    attachments: attachments.map((file) => file.id),
    requestId: crypto.randomUUID(),
  });
  await expect
    .poll(async () => (await client.get({ botId: bot.id })).busy)
    .toBe(false);
  await page.goto(service.url);
  await page.getByText("说明.md", { exact: true }).click();
  const panel = page.getByRole("complementary", {
    name: "文件预览",
    exact: true,
  });
  await expect(
    panel.getByRole("heading", { name: "文件预览验收", exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await panel.getByRole("button", { name: "下载文件", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("说明.md");
  await panel.getByRole("button", { name: "关闭", exact: true }).click();
  for (const [name, value] of [
    ["数据.csv", "one,two"],
    ["代码.ts", "const greeting"],
    ["损坏.pdf", "PDF 无法打开"],
    ["文件.bin", "此格式暂不支持预览"],
  ]) {
    await page
      .getByRole("button", { name: `预览 ${name}`, exact: true })
      .click();
    await expect(panel).toContainText(value ?? "");
    if (name === "数据.csv") {
      await expect(
        panel.getByRole("cell", { name: "001", exact: true }),
      ).toBeVisible();
      await expect(
        panel.getByRole("cell", { name: "multi line", exact: true }),
      ).toBeVisible();
    }
    await panel.getByRole("button", { name: "关闭", exact: true }).click();
  }
  await service.control({ history: 2400 });
  await page.reload();
  await page.getByRole("button", { name: /^(返回最新|有新消息)$/ }).click();
  await expect(
    page.getByRole("button", { name: "预览 说明.md", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const reading = Promise.withResolvers<void>();
  await page.route("**/rpc/files/list", async (route) => {
    await reading.promise;
    await route.continue();
  });
  await page
    .locator("#bot-details")
    .getByRole("button", { name: "文件与媒体", exact: true })
    .click();
  const loading = page.getByRole("status", {
    name: "正在读取文件",
    exact: true,
  });
  try {
    await expect(loading).toBeVisible();
    await expect(loading.locator(".loading-spinner")).toBeVisible();
    const bounds = await loading.boundingBox();
    const content = await page.locator(".detail-scroll").boundingBox();
    const search = await page
      .getByRole("tablist", { name: "文件分类" })
      .boundingBox();
    if (!bounds || !content || !search)
      throw new Error("Loading area required");
    expect(
      Math.abs(bounds.x + bounds.width / 2 - content.x - content.width / 2),
    ).toBeLessThan(2);
    expect(bounds.height).toBeGreaterThan(content.height / 2);
    expect(
      Math.abs(
        bounds.y +
          bounds.height / 2 -
          (search.y + search.height + content.y + content.height) / 2,
      ),
    ).toBeLessThan(16);
    await expect(loading).not.toContainText("正在读取文件");
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.screenshot({
        path: testInfo.outputPath(`files-loading-${colorScheme}.png`),
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(loading).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath("files-loading-narrow.png"),
    });
    await page.setViewportSize({ width: 1360, height: 900 });
  } finally {
    reading.resolve();
  }
  await expect(loading).toBeHidden();
  await page.unroute("**/rpc/files/list");
  const list = page.locator(".file-list");
  let categoryReads = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/rpc/files/list")) categoryReads++;
  });
  await expect(list.locator(".file-list-row")).toHaveCount(8);
  await list.getByRole("tab", { name: "图片与视频", exact: true }).click();
  await expect(list.locator(".file-list-row")).toHaveCount(2);
  await expect(list.locator(".file-list-thumbnail img")).toHaveCount(2);
  await expect
    .poll(() =>
      list
        .locator(".file-list-thumbnail img")
        .first()
        .evaluate(
          (image: HTMLImageElement) =>
            image.complete &&
            image.naturalWidth > 0 &&
            image.naturalWidth <= 160 &&
            image.naturalHeight <= 160,
        ),
    )
    .toBe(true);
  await expect(list.locator("video,audio")).toHaveCount(0);
  await list.getByRole("tab", { name: "音频", exact: true }).click();
  await expect(list.locator(".file-list-row")).toHaveCount(1);
  await expect(list).toContainText("语音.mp3");
  await list.getByRole("tab", { name: "文件", exact: true }).click();
  await expect(list.locator(".file-list-row")).toHaveCount(5);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.evaluate(async () => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
    await page.screenshot({ path: `tmp/file-ui/file-list-${colorScheme}.png` });
    await list.getByRole("tab", { name: "图片与视频", exact: true }).click();
    await page.screenshot({
      path: `tmp/file-ui/file-media-${colorScheme}.png`,
    });
    await list.getByRole("tab", { name: "音频", exact: true }).click();
    await page.screenshot({
      path: `tmp/file-ui/file-audio-${colorScheme}.png`,
    });
    await list.getByRole("tab", { name: "文件", exact: true }).click();
  }
  await list
    .getByRole("button", { name: "更多文件操作 说明.md", exact: true })
    .click();
  await page.screenshot({ path: "tmp/file-ui/file-list-menu.png" });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    list.getByRole("tab", { name: "图片与视频", exact: true }),
  ).toBeInViewport();
  expect(
    await list.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: "tmp/file-ui/file-list-narrow.png" });
  await page.setViewportSize({ width: 1360, height: 900 });
  await list.getByRole("tab", { name: "全部", exact: true }).click();
  expect(categoryReads).toBe(3);
  const filtering = Promise.withResolvers<void>();
  await page.route("**/rpc/files/list", async (route) => {
    await filtering.promise;
    await route.continue();
  });
  const rows = await page.locator(".file-list-row").count();
  await page
    .getByRole("searchbox", { name: "搜索文件", exact: true })
    .fill("说明");
  try {
    await expect(loading).toBeVisible();
    await expect(page.locator(".file-list-row")).toHaveCount(rows);
    await expect(
      page.getByRole("searchbox", { name: "搜索文件", exact: true }),
    ).toBeFocused();
  } finally {
    filtering.resolve();
  }
  await expect(loading).toBeHidden();
  await expect(page.locator(".file-list-row")).toHaveCount(1);
  await page
    .locator(".file-list")
    .getByRole("button", { name: "更多文件操作 说明.md", exact: true })
    .click();
  const reveal = Promise.withResolvers<void>();
  let historyReads = 0;
  await page.route("**/rpc/get", async (route) => {
    historyReads++;
    await reveal.promise;
    await route.continue();
  });
  const lastMessage = await page
    .locator("[data-transcript-key]")
    .last()
    .getAttribute("data-transcript-key");
  const beforeJump = await page
    .locator(".transcript")
    .evaluate((node) => node.scrollTop);
  await page.evaluate(() => {
    const windows: string[] = [];
    const frames: { at: number; key: string | null }[] = [];
    Reflect.set(window, "revealWindows", windows);
    Reflect.set(window, "revealFrames", frames);
    Reflect.set(window, "revealing", true);
    const record = () => {
      const first = document
        .querySelector("[data-transcript-key]")
        ?.getAttribute("data-transcript-key");
      if (first && windows.at(-1) !== first) windows.push(first);
    };
    record();
    const frame = (at: number) => {
      frames.push({
        at,
        key:
          document
            .querySelector("[data-transcript-key]")
            ?.getAttribute("data-transcript-key") ?? null,
      });
      if (Reflect.get(window, "revealing")) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    const observer = new MutationObserver(record);
    const messages = document.querySelector(".messages");
    if (!messages) throw new Error("Messages required");
    observer.observe(messages, { childList: true });
    Reflect.set(window, "revealObserver", observer);
  });
  await page
    .getByRole("menuitem", { name: "在聊天中查看", exact: true })
    .click();
  await expect.poll(() => historyReads).toBe(1);
  expect(
    await page
      .locator("[data-transcript-key]")
      .last()
      .getAttribute("data-transcript-key"),
  ).toBe(lastMessage);
  expect(
    await page.locator(".transcript").evaluate((node) => node.scrollTop),
  ).toBe(beforeJump);
  reveal.resolve();
  await expect(
    page
      .locator(".messages")
      .getByRole("button", { name: "预览 说明.md", exact: true }),
  ).toBeInViewport();
  expect(historyReads).toBe(1);
  const windows = await page.evaluate(() => {
    (Reflect.get(window, "revealObserver") as MutationObserver).disconnect();
    return Reflect.get(window, "revealWindows") as string[];
  });
  expect(windows.length).toBeLessThanOrEqual(2);
  const frames = await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    Reflect.set(window, "revealing", false);
    return Reflect.get(window, "revealFrames") as {
      at: number;
      key: string | null;
    }[];
  });
  expect(frames.every((frame) => windows.includes(frame.key ?? ""))).toBe(true);
  await writeFile(
    "tmp/file-ui/history-location-performance.json",
    JSON.stringify({ historyReads, windows, frames }, null, 2),
  );
  expect(
    await page.locator("[data-transcript-key]").count(),
  ).toBeLessThanOrEqual(200);
  await page.unroute("**/rpc/get");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({
      path: `tmp/file-ui/file-source-${colorScheme}.png`,
      animations: "disabled",
    });
  }
  const input = page.getByLabel("消息", { exact: true });
  await input.fill("定位后保留的草稿");
  const firstKey = await page
    .locator("[data-transcript-key]")
    .first()
    .getAttribute("data-transcript-key");
  for (let index = 0; index < 3; index++) {
    await page
      .locator("#bot-details")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page.getByRole("button", { name: "Bot详情", exact: true }).click();
    expect(
      await page
        .locator("[data-transcript-key]")
        .first()
        .getAttribute("data-transcript-key"),
    ).toBe(firstKey);
    await expect(input).toHaveText("定位后保留的草稿");
    expect(
      await page
        .locator(".workspace-content")
        .evaluate((node) => getComputedStyle(node).viewTransitionName),
    ).toBe("none");
  }
  await page
    .getByRole("button", { name: "查看较新的消息", exact: true })
    .scrollIntoViewIfNeeded();
  await page
    .getByRole("button", { name: "查看较新的消息", exact: true })
    .click();
  await expect(
    page.getByLabel("你的消息", { exact: true }).last(),
  ).toContainText("历史任务");
  await page.getByRole("button", { name: /^(返回最新|有新消息)$/ }).click();
  await expect(
    page.getByLabel("你的消息", { exact: true }).last(),
  ).toContainText("历史任务 2400");
  await expect(input).toHaveText("定位后保留的草稿");
});

test("interactive HTML keeps its state when expanded and cannot access the host or network", async ({
  service,
  page,
}) => {
  test.setTimeout(60_000);
  const client: RouterClient<AppRouter> = createORPCClient(
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  const bot = (await client.bots.list())[0];
  if (!bot) throw new Error("Bot required");
  const html = `<!doctype html><html><body><label>金额<input aria-label="金额" value="10"></label><button id="calc" onclick="document.querySelector('output').textContent=Number(document.querySelector('input').value)*2">计算</button><output>20</output><p id="security"></p><a href="https://example.invalid/escape">外部链接</a><script>
let blocked=false;try{parent.document.body.dataset.escaped='yes'}catch{blocked=true}
document.querySelector('#security').textContent=blocked&&typeof window.domosDesktop==='undefined'?'已隔离':'隔离失败';
fetch('https://example.invalid/leak').catch(()=>{});
</script></body></html>`;
  const file = await client.files.upload({
    botId: bot.id,
    file: new File([html], "计算器.html"),
  });
  await service.control({
    responses: [
      {
        content: [
          {
            type: "toolCall",
            id: "inline-html",
            name: "attach_file",
            arguments: { path: file.path, display: "inline" },
          },
        ],
        stopReason: "toolUse",
      },
      { content: "计算器已就绪。" },
    ],
  });
  await client.send({
    botId: bot.id,
    text: "交付计算器",
    requestId: crypto.randomUUID(),
  });
  await expect
    .poll(async () => (await client.get({ botId: bot.id })).busy)
    .toBe(false);
  let network = 0;
  await page.route("https://example.invalid/**", (route) => {
    network++;
    return route.abort();
  });
  await page.goto(service.url);
  const inline = page
    .frameLocator(".inline-file iframe")
    .frameLocator("iframe");
  await expect(inline.getByText("已隔离", { exact: true })).toBeVisible();
  await inline.getByRole("textbox", { name: "金额", exact: true }).fill("123");
  await inline.getByRole("button", { name: "计算", exact: true }).click();
  await expect(inline.locator("output")).toHaveText("246");
  await page
    .getByRole("button", { name: "预览 计算器.html", exact: true })
    .click();
  const panel = page.getByRole("complementary", {
    name: "文件预览",
    exact: true,
  });
  const expanded = panel.frameLocator("iframe").frameLocator("iframe");
  await expect(
    expanded.getByRole("textbox", { name: "金额", exact: true }),
  ).toHaveValue("123");
  await expect(expanded.locator("output")).toHaveText("246");
  await expanded.getByRole("link", { name: "外部链接", exact: true }).click();
  await expect(
    expanded.getByRole("textbox", { name: "金额", exact: true }),
  ).toBeVisible();
  expect(network).toBe(0);
  expect(await page.locator("body").getAttribute("data-escaped")).toBeNull();
  await service.control({ content: "已完成。" });
  await client.send({
    botId: bot.id,
    text: "后台更新",
    requestId: crypto.randomUUID(),
  });
  await expect
    .poll(async () => (await client.get({ botId: bot.id })).busy)
    .toBe(false);
  await expect(
    expanded.getByRole("textbox", { name: "金额", exact: true }),
  ).toHaveValue("123");
  await page.evaluate(() => document.activeViewTransition?.finished);
  await panel.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(
    inline.getByRole("textbox", { name: "金额", exact: true }),
  ).toHaveValue("123");
  await page.reload();
  await expect(
    inline.getByRole("textbox", { name: "金额", exact: true }),
  ).toHaveValue("10");
  await inline.getByRole("button", { name: "计算", exact: true }).click();
  await expect(inline.locator("output")).toHaveText("20");
});

test("PDF preview renders selectable pages in both themes and a narrow panel", async ({
  service,
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await service.control({ content: "已收到。" });
  await page.goto(service.url);
  await attachFiles(page, {
    name: "阅读.pdf",
    mimeType: "application/pdf",
    buffer: pdf(),
  });
  await expect(
    page.getByRole("button", { name: "移除文件 阅读.pdf", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill("阅读文件");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page
    .getByRole("button", { name: "预览 阅读.pdf", exact: true })
    .click();
  const panel = page.getByRole("complementary", {
    name: "文件预览",
    exact: true,
  });
  await expect(panel.locator(".textLayer").first()).toContainText(
    "PDF page one",
  );
  await expect(panel.locator("canvas").first()).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "适应宽度", exact: true }),
  ).toBeVisible();
  await expect(panel.locator(".file-panel-content")).toHaveCSS(
    "overflow-y",
    "hidden",
  );
  const paper = await panel.locator(".pdfViewer .page").first().boundingBox();
  const readingArea = await panel.locator(".file-pdf-scroll").boundingBox();
  expect(paper && readingArea && paper.x > readingArea.x + 8).toBe(true);
  expect(
    paper &&
      readingArea &&
      Math.abs(
        paper.x + paper.width / 2 - readingArea.x - readingArea.width / 2,
      ) < 2,
  ).toBe(true);
  const resize = page.getByRole("separator", { name: "调整详情宽度" });
  const handle = await resize.boundingBox();
  if (!handle) throw new Error("File resize handle required");
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(handle.x - 150, handle.y + handle.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await panel.getByRole("button", { name: "适应宽度", exact: true }).click();
  await expect
    .poll(() =>
      panel
        .locator(".file-pdf-scroll")
        .evaluate((node) => node.scrollWidth <= node.clientWidth),
    )
    .toBe(true);
  await panel.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(panel.getByRole("toolbar")).toContainText("2 / 2");
  await expect(panel.locator(".textLayer").last()).toContainText(
    "PDF page two",
  );
  await panel.getByRole("button", { name: "放大", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("files-pdf-light.png") });
  await panel.getByRole("button", { name: "关闭", exact: true }).click();
  await chooseAppearance(page, "深色");
  await page.setViewportSize({ width: 390, height: 760 });
  await page
    .getByRole("button", { name: "预览 阅读.pdf", exact: true })
    .click();
  await expect(panel.getByRole("toolbar")).toContainText("2 / 2");
  await panel.getByRole("button", { name: "上一页", exact: true }).click();
  await expect(panel.getByRole("toolbar")).toContainText("1 / 2");
  await expect(panel.locator(".textLayer").first()).toContainText(
    "PDF page one",
  );
  await expect(panel).toBeInViewport();
  expect(
    await panel.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await panel.getByRole("button", { name: "适应宽度", exact: true }).click();
  await expect
    .poll(() =>
      panel
        .locator(".file-pdf-scroll")
        .evaluate((node) => node.scrollWidth <= node.clientWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("files-pdf-dark-narrow.png"),
  });
});

test("file reads recover from failure and cannot cross a Bot switch", async ({
  service,
  page,
}) => {
  const client: RouterClient<AppRouter> = createORPCClient(
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  const bot = (await client.bots.list())[0];
  if (!bot) throw new Error("Bot required");
  const file = await client.files.upload({
    botId: bot.id,
    file: new File(["长内容".repeat(80_000)], "长文.txt"),
  });
  await service.control({ content: "已收到。" });
  await client.send({
    botId: bot.id,
    text: "保存文件",
    attachments: [file.id],
    requestId: crypto.randomUUID(),
  });
  await expect
    .poll(async () => (await client.get({ botId: bot.id })).busy)
    .toBe(false);
  await page.goto(service.url);
  await createBot(page, "文件隔离助手");
  const contacts = page.getByRole("navigation", {
    name: "联系人",
    exact: true,
  });
  await contacts.getByRole("link", { name: /^Domos/ }).click();
  await page.route("**/files/*/*?download=1", (route) => route.abort(), {
    times: 1,
  });
  await page
    .getByRole("button", { name: "预览 长文.txt", exact: true })
    .click();
  const panel = page.getByRole("complementary", {
    name: "文件预览",
    exact: true,
  });
  await expect(panel.getByRole("alert")).toContainText("文件读取失败");
  await panel.getByRole("button", { name: "关闭", exact: true }).click();
  const release = Promise.withResolvers<void>();
  const requested = Promise.withResolvers<void>();
  await page.route("**/files/*/*?download=1", async (route) => {
    requested.resolve();
    await release.promise;
    await route.continue().catch(() => {});
  });
  try {
    await page
      .getByRole("button", { name: "预览 长文.txt", exact: true })
      .click();
    await panel.getByRole("button", { name: "重试", exact: true }).click();
    await requested.promise;
    await expect(
      page
        .getByRole("complementary", { name: "文件预览", exact: true })
        .getByRole("status", { name: "正在打开文件", exact: true }),
    ).toBeVisible();
    await contacts.getByRole("link", { name: /^文件隔离助手/ }).click();
    release.resolve();
    await expect(
      page.getByRole("complementary", { name: "文件预览", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Bot详情", exact: true }).click();
    await page
      .locator("#bot-details")
      .getByRole("button", { name: "文件与媒体", exact: true })
      .click();
    await expect(page.locator(".file-list")).toContainText("此分类暂无附件");
  } finally {
    release.resolve();
    await page.unroute("**/files/*/*?download=1");
  }
  await contacts.getByRole("link", { name: /^Domos/ }).click();
  let repeatedReads = 0;
  await page.route("**/files/*/*?download=1", async (route) => {
    repeatedReads++;
    await route.continue();
  });
  await page
    .getByRole("button", { name: "预览 长文.txt", exact: true })
    .click();
  await expect(panel).toContainText("仅预览前 200,000 个字符");
  expect(await panel.locator("pre").textContent()).toHaveLength(200_000);
  expect(repeatedReads).toBe(0);
});

test("completed messages and published files arrive before the final reply", async ({
  service,
  page,
}) => {
  await service.control("gate");
  const call = (name: string, args: Record<string, unknown>) => ({
    type: "toolCall",
    id: crypto.randomUUID(),
    name,
    arguments: args,
  });
  await service.control({
    responses: [
      {
        content: [
          { type: "text", text: "我会先生成报告。" },
          call("write", { path: "report.md", content: "# Report" }),
        ],
        stopReason: "toolUse",
      },
      {
        content: [call("attach_file", { path: "report.md" })],
        stopReason: "toolUse",
      },
    ],
  });
  await page.goto(service.url);
  await page.getByLabel("消息", { exact: true }).fill("生成报告");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByRole("button", { name: "批准", exact: true }).click();
  await expect(page.locator(".typing-dots")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "另存为 report.md", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(1);
  await expect(page.getByLabel("Domos 的回复")).toContainText(
    "我会先生成报告。",
  );
  await page.screenshot({
    path: "test-results/completed-message-delivery.png",
  });
  await service.control("release");
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "另存为 report.md", exact: true }),
  ).toBeVisible();
});

test("file drafts, real tools, and published downloads survive Bot switches and restart", async ({
  service,
  page,
}) => {
  await page.goto(service.url);
  const input = page.getByLabel("消息", { exact: true });
  const send = page.getByRole("button", { name: "发送", exact: true });
  await expect(
    page.getByRole("button", { name: "添加内容", exact: true }),
  ).toBeEnabled();
  const source = `Source ${crypto.randomUUID()}`;
  await attachFiles(page, {
    name: "资料.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(source),
  });
  await expect(
    page.getByRole("button", { name: "移除文件 资料.txt", exact: true }),
  ).toBeEnabled();
  const file = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) =>
      key.startsWith("domos:composer:v2:"),
    );
    return JSON.parse(localStorage.getItem(key ?? "") ?? "{}")
      .attachments[0] as { id: string; path: string };
  });
  await input.fill("整理成报告");
  await page.reload();
  await expect(input).toHaveText("整理成报告");
  await expect(
    page.getByRole("button", { name: "移除文件 资料.txt", exact: true }),
  ).toBeVisible();
  await createBot(page, "其他助手");
  await expect(page.locator(".composer-attachments")).toHaveCount(0);
  await page.getByRole("link", { name: "Domos", exact: true }).click();
  await expect(input).toHaveText("整理成报告");
  const call = (name: string, args: Record<string, unknown>) => ({
    type: "toolCall",
    id: crypto.randomUUID(),
    name,
    arguments: args,
  });
  await service.control({
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
  await page.getByRole("button", { name: "批准", exact: true }).click();
  await page.getByRole("button", { name: "批准", exact: true }).click();
  const report = page.getByRole("button", {
    name: "另存为 report.md",
    exact: true,
  });
  await expect(report).toBeVisible();
  await expect(
    page.getByRole("button", { name: "语音输入（暂未开放）", exact: true }),
  ).toBeVisible();
  await expect(input).toHaveText("");
  await expect(page.locator(".composer-attachments")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "另存为 资料.txt", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(1);
  await expect(page.locator(".message.toolResult")).toHaveCount(0);
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
  await page
    .locator("#bot-details")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await report.scrollIntoViewIfNeeded();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({
    path: "test-results/files-mobile.png",
    fullPage: true,
  });
  const port = Number(new URL(service.url).port);
  await service.stop();
  await service.start(port);
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

test("file lists retain pages across opens and update when new attachments arrive", async ({
  service,
  page,
}) => {
  const rpc: RouterClient<AppRouter> = createORPCClient(
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  const bot = (await rpc.bots.list())[0];
  if (!bot) throw new Error("Bot required");
  let reads = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/rpc/files/list")) reads++;
  });
  await page.goto(service.url);
  const details = await openDetails(page);
  await details
    .getByRole("button", { name: "文件与媒体", exact: true })
    .click();
  await expect(details).toContainText("此分类暂无附件");
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await details
    .getByRole("button", { name: "文件与媒体", exact: true })
    .click();
  await expect(details).toContainText("此分类暂无附件");
  expect(reads).toBe(1);
  const file = await rpc.files.upload({
    botId: bot.id,
    file: new File(["New evidence"], "new-report.txt"),
  });
  await service.control({ content: "已收到。" });
  await rpc.send({
    botId: bot.id,
    text: "保存附件",
    attachments: [file.id],
    requestId: crypto.randomUUID(),
  });
  await expect(
    details.getByRole("button", { name: "预览 new-report.txt", exact: true }),
  ).toBeVisible();
  expect(reads).toBe(2);
});
