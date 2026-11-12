import { type ChildProcess, fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { characterIdentity } from "@domos/ui/characters";
import { layout } from "@domos/ui/tokens";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { expect, type FileChooser, type Page, test } from "@playwright/test";
import { pdf } from "../../../packages/agent/test/fixtures/pdf.ts";
import { png } from "../../../packages/agent/test/fixtures/png.ts";
import type { AppRouter } from "../../api/src/router.ts";

let worker: ChildProcess;
let url: string;
let database: string;
let directory: string;
let toolName: string;

async function start(port = 0, native = false) {
  worker = fork(
    fileURLToPath(
      new URL("../../api/test/fixtures/web-server.ts", import.meta.url),
    ),
    [database, String(port), native ? "native" : ""],
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
    | { history: number }
    | { handoff: string }
    | {
        nativeSkills: {
          name: string;
          description?: string;
          path?: string;
          source: "project" | "user";
        }[];
        skillsNotice?: string;
      }
    | { content: unknown; stopReason?: "stop" | "toolUse" }
    | {
        responses: {
          content: unknown;
          stopReason?: "stop" | "toolUse" | "error";
          errorMessage?: string;
        }[];
      },
) {
  const receipt = once(worker, "message");
  worker.send(command);
  await receipt;
}

async function attachFiles(
  page: Page,
  files: Parameters<FileChooser["setFiles"]>[0],
) {
  await page.getByRole("button", { name: "添加内容", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "添加文件", exact: true }).click();
  await (await chooser).setFiles(files);
}

async function openSettings(page: import("@playwright/test").Page) {
  if ((page.viewportSize()?.width ?? 0) < layout.sidebar.min + layout.chatMin)
    await expect(page.locator(".workspace")).toHaveAttribute(
      "data-mobile",
      "true",
    );
  else
    await expect(page.locator(".workspace")).not.toHaveAttribute("data-mobile");
  const settings = page.getByRole("main", { name: "设置", exact: true });
  if (!(await settings.isVisible())) {
    const overlay = page.locator(
      '.workspace-panel[data-side="inspector"][data-modal]',
    );
    if (await overlay.isVisible())
      await overlay.getByRole("button", { name: "关闭", exact: true }).click();
    const contacts = page.getByRole("button", { name: "联系人", exact: true });
    if (
      (page.viewportSize()?.width ?? 0) <
      layout.sidebar.min + layout.chatMin
    ) {
      await contacts.click();
    } else await expect(contacts).toHaveCount(0);
    await page.getByRole("button", { name: "用户菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: "设置", exact: true }).click();
    await expect(page.locator(".settings-main")).toBeFocused();
  }
  await settings.getByRole("tab", { name: "通用", exact: true }).click();
  return settings;
}

async function chooseAppearance(
  page: import("@playwright/test").Page,
  label: string,
) {
  const settings = page.getByRole("main", { name: "设置", exact: true });
  const opened = !(await settings.isVisible());
  await openSettings(page);
  await page.getByRole("combobox", { name: "外观", exact: true }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
  if (opened)
    await settings
      .getByRole("button", { name: "返回对话", exact: true })
      .click();
}

async function chooseDetail(
  details: import("@playwright/test").Locator,
  label: string,
) {
  await expect(details).toBeVisible();
  if (label === "电脑") {
    await details.getByRole("tab", { name: "Computer", exact: true }).click();
    await details
      .page()
      .getByRole("button", { name: "电脑设置", exact: true })
      .click();
    return;
  }
  const back = details.getByRole("button", { name: "返回", exact: true });
  if (await back.isVisible()) await back.click();
  if (label === "身份") {
    const edit = details.getByRole("button", { name: "编辑", exact: true });
    if (await edit.count()) await edit.click();
    return;
  }
  const row = details.getByRole("button", {
    name: new RegExp(`^${label}(?:\\s|$)`),
  });
  if (await row.count()) await row.click();
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
  await chooseDetail(details, "运行");
  const picker = details.getByRole("combobox", { name: "模型", exact: true });
  await expect(picker).toContainText(text);
  await details.getByRole("button", { name: "关闭", exact: true }).click();
}

async function expectTextContrast(page: import("@playwright/test").Page) {
  const ratios = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas required for color measurement");
    const luminance = (color: string) => {
      if (color) {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
      }
      const channels = [...context.getImageData(0, 0, 1, 1).data]
        .slice(0, 3)
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
        ".chat-preview span, .picker-trigger, .message-bubble, .picker-item, .message-composer-editor",
      ),
    ].map((element) => {
      const parents: Element[] = [];
      for (
        let parent: Element | null = element;
        parent;
        parent = parent.parentElement
      )
        parents.unshift(parent);
      context.clearRect(0, 0, 1, 1);
      for (const parent of parents) {
        context.fillStyle = getComputedStyle(parent).backgroundColor;
        context.fillRect(0, 0, 1, 1);
      }
      const surface = luminance("");
      const foreground = luminance(
        getComputedStyle(
          element,
          element.matches("textarea") ? "::placeholder" : null,
        ).color,
      );
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

test("context handoff scope stays readable in both themes and narrow panels", async ({
  page,
}, testInfo) => {
  const notice = "已交接摘要和近期原文。省略的细节可通过聊天记录查询。";
  await control({ handoff: notice });
  await page.goto(url);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  for (const theme of ["浅色", "深色"]) {
    await chooseAppearance(page, theme);
    const details = await openDetails(page);
    await details
      .getByRole("button", { name: "上下文窗口", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: notice }),
    ).toBeVisible();
    await page.locator(".context-window-popup").evaluate(async (element) => {
      await Promise.all(
        element.getAnimations().map((animation) => animation.finished),
      );
    });
    await expectTextContrast(page);
    const path = testInfo.outputPath(`handoff-${theme}.png`);
    await page.screenshot({ path });
    await testInfo.attach(`handoff-${theme}`, {
      path,
      contentType: "image/png",
    });
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 540, height: 760 });
  await (await openDetails(page))
    .getByRole("button", { name: "上下文窗口", exact: true })
    .click();
  const status = page.getByRole("status").filter({ hasText: notice });
  await expect(status).toBeVisible();
  const bounds = await status.boundingBox();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(540);
});

test("files preview documents, search old history and return to the source", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const client: RouterClient<AppRouter> = createORPCClient(
    new RPCLink({ url: `${url}/rpc` }),
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
  await control({ content: "已完成。" });
  await client.send({
    botId: bot.id,
    text: "文件验收",
    attachments: attachments.map((file) => file.id),
    requestId: crypto.randomUUID(),
  });
  await expect
    .poll(async () => (await client.get({ botId: bot.id })).busy)
    .toBe(false);
  await page.goto(url);
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
  await control({ history: 2400 });
  await page.reload();
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
  await page.getByRole("button", { name: "返回最新", exact: true }).click();
  await expect(
    page.getByLabel("你的消息", { exact: true }).last(),
  ).toContainText("历史任务 2400");
  await expect(input).toHaveText("定位后保留的草稿");
});

test("interactive HTML keeps its state when expanded and cannot access the host or network", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const client: RouterClient<AppRouter> = createORPCClient(
    new RPCLink({ url: `${url}/rpc` }),
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
  await control({
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
  await page.goto(url);
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
  await control({ content: "已完成。" });
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
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await control({ content: "已收到。" });
  await page.goto(url);
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
  page,
}) => {
  const client: RouterClient<AppRouter> = createORPCClient(
    new RPCLink({ url: `${url}/rpc` }),
  );
  const bot = (await client.bots.list())[0];
  if (!bot) throw new Error("Bot required");
  const file = await client.files.upload({
    botId: bot.id,
    file: new File(["长内容".repeat(80_000)], "长文.txt"),
  });
  await control({ content: "已收到。" });
  await client.send({
    botId: bot.id,
    text: "保存文件",
    attachments: [file.id],
    requestId: crypto.randomUUID(),
  });
  await expect
    .poll(async () => (await client.get({ botId: bot.id })).busy)
    .toBe(false);
  await page.goto(url);
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

test("model selection updates immediately and restores a failed save", async ({
  page,
}) => {
  const saving = Promise.withResolvers<void>();
  const requested = Promise.withResolvers<void>();
  let requests = 0;
  await page.route("**/rpc/engines/configure", async (route) => {
    requests++;
    if (requests === 1) {
      requested.resolve();
      await saving.promise;
      await route.continue();
    } else await route.abort();
  });
  try {
    await page.goto(url);
    const details = await openDetails(page);
    const picker = details.getByRole("combobox", { name: "模型", exact: true });
    await picker.click();
    await page
      .getByRole("option", { name: "Pi · 测试模型二", exact: true })
      .click();
    await requested.promise;
    await expect(picker).toContainText("测试模型二");
    await expect(page.locator(".model-selector-popup")).toHaveCount(0);
    await expect(picker).toBeEnabled();
    saving.resolve();
    await expect(picker).toContainText("测试模型二");
    await picker.click();
    await page
      .getByRole("option", { name: "Pi · 测试模型一", exact: true })
      .click();
    await expect(details.getByRole("alert")).toBeVisible();
    await expect(picker).toContainText("测试模型二");
    expect(requests).toBe(2);
  } finally {
    saving.resolve();
  }
});

async function createBot(
  page: import("@playwright/test").Page,
  name: string,
  model?: string,
) {
  await expect(page.locator(".sidebar-toolbar")).toBeAttached();
  if (
    !(await page.getByRole("button", { name: "新建", exact: true }).isVisible())
  )
    await page.getByRole("button", { name: "联系人", exact: true }).click();
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page.getByRole("menuitem", { name: "新建 Bot", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建 Bot", exact: true });
  await dialog.getByLabel("名字", { exact: true }).fill(name);
  await expect(dialog.getByRole("textbox")).toHaveCount(1);
  await expect(dialog.getByRole("combobox")).toHaveCount(0);
  await dialog.getByRole("button", { name: "创建", exact: true }).click();

  await dialog.getByRole("button", { name: "Pi", exact: true }).click();
  await dialog.getByRole("combobox", { name: "模型", exact: true }).click();
  await page
    .getByRole("option", {
      name: `Pi · ${model ?? "测试模型一"}`,
      exact: true,
    })
    .click();
  await dialog.getByRole("button", { name: "开始聊天", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("消息", { exact: true })).toHaveAttribute(
    "data-placeholder",
    `发送消息给 ${name}…`,
  );
}

test("chat suggestions fill the draft and dismissal stays complete on other devices and after restart", async ({
  page,
  browser,
}, testInfo) => {
  await page.goto(url);
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
    await second.goto(url);
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
    const port = Number(new URL(url).port);
    await stop();
    await start(port);
    await page.reload();
    await expect(input).toBeVisible();
    await expect(welcome).toBeHidden();
    await expect(input).toHaveText(/我已有的草稿/);
  } finally {
    await remote.close();
  }
});

test("Bot details manage identity, memory, shared skills, routines and actual prompts", async ({
  page,
}) => {
  await page.goto(url);
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
  await expect(memoryDialog.locator(".item-list")).toContainText(
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
  await control({ content: "报告已交付。" });
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
  const port = Number(new URL(url).port);
  await stop();
  await start(port);
  await page.reload();
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await chooseDetail(sections, "记忆");
  await expect(memoryDialog.locator(".item-list")).toContainText(
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
    .locator(".item-list li")
    .filter({ hasText: "报告使用公制单位。" });
  const remove = memory.getByRole("button", { name: "记忆操作", exact: true });
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
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(url);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const dialog = page.getByRole("complementary", { name: /的详情$/ });
  const sections = dialog;
  await chooseDetail(sections, "技能");
  await dialog.getByRole("button", { name: "新建技能", exact: true }).click();
  await dialog.getByLabel("新建 SKILL.md").fill("invalid skill");
  await dialog.getByRole("button", { name: "保存技能", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("YAML");
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
  page,
}) => {
  await page.goto(url);
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
    expect(panelBox.x + panelBox.width).toBeCloseTo(1360, 0);
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
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
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
  await expect(input).toHaveText("原来的草稿");
  await expectModel(page, "测试模型一");
  await createBot(page, "写作助手");
  await input.fill("写作问题");
  await send.click();
  await expect(page.getByLabel("写作助手 的回复")).toContainText("faux-1");
  await expect(send).toBeVisible();
  await input.fill("写作草稿");
  await contacts.getByRole("link", { name: "研究员", exact: true }).click();
  await expect(input).toHaveText("研究草稿");
  await expect(page.getByLabel("你的消息")).toContainText("研究问题");
  await expectModel(page, "测试模型二");
  await page.reload();
  await expect(input).toHaveText("研究草稿");
  await other.close();
  const port = Number(new URL(url).port);
  await stop();
  await start(port);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  expect(page.url()).toBe(researchUrl);
  await expect(contacts.getByRole("link")).toHaveCount(3);
  await expect(page.getByLabel("研究员 的回复")).toContainText("faux-2");
  await contacts.getByRole("link", { name: "写作助手", exact: true }).click();
  await expect(input).toHaveText("写作草稿");
  await expect(page.getByLabel("你的消息")).toContainText("写作问题");
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
  await expect(input).toHaveAttribute("data-placeholder", "发送消息给 Domos…");
  await control("gate");
  await input.fill("后台任务");
  await send.click();
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  await contacts.getByRole("link", { name: "助手", exact: true }).click();
  await expect(input).toHaveAttribute("data-placeholder", "发送消息给 助手…");
  await input.fill("另一个任务");
  await send.click();
  await expect(page.getByLabel("助手 的回复")).toContainText("完整回复。");
  await expect(send).toBeVisible();
  await contacts.getByRole("link", { name: /^Domos/ }).click();
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  await control("release");
  await expect(page.getByLabel("Domos 的回复")).toContainText("后台任务");
  await expect(send).toBeVisible();
  await expect(page.getByLabel("你的消息")).toContainText("后台任务");
});

test("creation retries keep one contact and themed dialogs work on narrow screens", async ({
  page,
}) => {
  await page.goto(url);
  const trigger = page.getByRole("button", { name: "新建", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "新建 Bot", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建 Bot", exact: true });
  const name = dialog.getByLabel("名字", { exact: true });
  await expect(
    dialog.getByRole("button", { name: "选择头像", exact: true }),
  ).toBeFocused();
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
    await expect(dialog.getByRole("textbox")).toHaveCount(1);
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
  await create.click();
  await expect(dialog.getByRole("alert")).toContainText("创建未确认");
  await create.click();
  await dialog.getByRole("button", { name: "Pi", exact: true }).click();
  await dialog.getByRole("combobox", { name: "模型", exact: true }).click();
  await page
    .getByRole("option", { name: "Pi · 测试模型一", exact: true })
    .click();
  await dialog.getByRole("button", { name: "开始聊天", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "联系人", exact: true }).click();
  const contacts = page.getByRole("navigation", {
    name: "联系人",
    exact: true,
  });
  await expect(contacts.getByRole("link")).toHaveCount(2);
  await expect(
    contacts.getByRole("link", { name: "设计助手", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await contacts.getByRole("link", { name: "Domos", exact: true }).click();
  await expect(page.getByLabel("消息", { exact: true })).toHaveAttribute(
    "data-placeholder",
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
  await chooseDetail(details, "运行");
  const picker = page.getByRole("combobox", { name: "模型", exact: true });
  await expect(picker).not.toContainText("DeepSeek");
  subscription.resolve();
  await expect(picker).toBeEnabled();
  await picker.click();
  await page
    .getByRole("option", { name: "Pi · 测试模型二", exact: true })
    .click();
  await expect(picker).toContainText("测试模型二");
  await page.reload();
  await chooseDetail(await openDetails(page), "运行");
  await expect(picker).toContainText("测试模型二");
  const connected = page.getByRole("button", { name: "添加内容", exact: true });
  await expect(connected).toBeEnabled();
  const port = Number(new URL(url).port);
  await stop();
  await expect(connected).toBeDisabled();
  await start(port);
  await expect(connected).toBeEnabled();
  await details.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(details).toBeHidden();
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
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(0);
  await page.goto("about:blank");
  await control("release");
  await page.goto(url);
  await expect(page.getByLabel("Domos 的回复")).toContainText("完整回复。");
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeVisible();
  const contactTime = page.locator('.contact-row[aria-current="page"] time');
  await expect(contactTime).toHaveText(/^\d{2}:\d{2}$/);
  const lastMessage = (
    await createORPCClient<RouterClient<AppRouter>>(
      new RPCLink({ url: `${url}/rpc` }),
    ).get({ botId: 1 })
  ).messages.at(-1);
  await expect(contactTime).toHaveAttribute(
    "datetime",
    new Date(lastMessage?.timestamp ?? 0).toISOString(),
  );
  const savedTime = await contactTime.getAttribute("datetime");
  await page.screenshot({ path: "test-results/chat-conversation.png" });
  const port = Number(new URL(url).port);
  await stop();
  await start(port);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("Domos 的回复")).toContainText("记住这句话");
  await expect(page.getByLabel("你的消息")).toHaveCount(1);
  await expect(contactTime).toHaveAttribute("datetime", savedTime ?? "");
});

test("a killed server retains uncertain work and permits an explicit retry", async ({
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
  await control("wait-model");
  const port = Number(new URL(url).port);
  await stop();
  await expect(contact.locator(".avatar-status")).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "正在重连" }),
  ).toBeAttached();
  await start(port);
  await expect(
    page.getByRole("log", { name: "聊天记录" }).getByRole("alert"),
  ).toContainText("执行结果未确认");
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(0);
  await expect(page.getByLabel("你的消息")).toHaveCount(1);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  await expect(contact.locator(".avatar-status")).toHaveCount(0);
  await page.getByLabel("消息", { exact: true }).fill("重试恢复未完成任务");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByLabel("Domos 的回复")).toContainText("完整回复。");
  await expect(page.getByLabel("你的消息")).toHaveCount(2);
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
    const offset = await dot.evaluate((element) => {
      const frame = element.closest(".bot-avatar")?.getBoundingClientRect();
      if (!frame) throw new Error("Working avatar missing");
      const bounds = element.getBoundingClientRect();
      return {
        right: bounds.right - frame.right,
        bottom: bounds.bottom - frame.bottom,
      };
    });
    expect(offset.right).toBeCloseTo(0, 0);
    expect(offset.bottom).toBeCloseTo(0, 0);
    await page.screenshot({
      path: `test-results/contacts-${theme}-working.png`,
      animations: "disabled",
    });
  }
  await control("release");
  await expect(second.locator(".avatar-status")).toHaveCount(0);
  await expect(first.locator(".avatar-status")).toBeVisible();
  await first.click();
  await page.getByRole("button", { name: "停止生成", exact: true }).click();
  await expect(page.locator(".sidebar .avatar-status")).toHaveCount(0);
});

test("chat gutters align within the content limit while panels resize", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const code = "long_identifier_".repeat(24);
  const answer = `**回复已完成。**\n\n这是一段完整交付的消息，用来检查聊天区域的自然换行。\n\n\`\`\`text\n${code}\n\`\`\`\n\n| 名称 | 说明 |\n| --- | --- |\n| 文件 | ${code} |`;
  await control({ content: answer });
  await page.goto(url);
  const input = page.getByLabel("消息", { exact: true });
  await expect(input).toBeEnabled();
  await input.fill("请完整回复，检查长消息能使用规定的气泡宽度。".repeat(10));
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const reply = page.getByLabel("Domos 的回复").locator(".message-bubble");
  await expect(reply.locator("pre code")).toHaveText(code, { timeout: 30_000 });
  await expect(page.locator(".chat-preview span").first()).toContainText(
    "回复已完成。",
  );
  await expect(page.locator(".chat-preview span").first()).not.toContainText(
    "**",
  );
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
      await expect(page.locator(".chat-preview span").first()).toHaveCSS(
        "font-size",
        "12px",
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
  await control({ content: "好的。" });
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

test("a reply arrives complete while typing survives reloads", async ({
  page,
}) => {
  const answer = "完整回答。资料已经核对，以下内容一次交付。".repeat(8);
  await control("gate-tool");
  await control({
    responses: [
      {
        stopReason: "toolUse",
        content: [
          {
            type: "toolCall",
            id: crypto.randomUUID(),
            name: toolName,
            arguments: { text: "已核对" },
          },
        ],
      },
      { content: answer },
    ],
  });
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
  await page.getByLabel("消息", { exact: true }).fill("完整交付");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const typing = page.getByRole("status", {
    name: "Domos 正在回复",
    exact: true,
  });
  await expect(typing).toBeVisible();
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(0);
  await page.reload();
  await expect(typing).toBeVisible();
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(0);
  await control("release");
  await expect(page.getByLabel("Domos 的回复")).toHaveText(answer);
  const frames = await page.evaluate(
    () => (window as unknown as { replyFrames: string[] }).replyFrames,
  );
  expect(frames.length).toBeGreaterThan(0);
  expect(new Set(frames)).toEqual(new Set([answer]));
  await expect(typing).toHaveCount(0);
  const port = Number(new URL(url).port);
  await stop();
  await start(port);
  await page.reload();
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(1);
  await expect(page.getByLabel("Domos 的回复")).toHaveText(answer);
});

test("stopping preserves the conversation and resending uses the message menu", async ({
  page,
}) => {
  await control({ content: "这份尚未生成完毕的回答。".repeat(30) });
  await page.goto(url);
  await page.getByLabel("消息", { exact: true }).fill("停止这次回答");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".typing-dots")).toBeVisible();
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(0);
  await page.getByRole("button", { name: "停止生成", exact: true }).click();
  const notice = page.locator('.task-notice[data-state="stopped"]');
  await expect(notice).toHaveCount(0);
  await expect(page.locator(".typing-dots")).toHaveCount(0);
  await page.reload();
  await expect(notice).toHaveCount(0);
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(0);
  await page
    .getByLabel("你的消息")
    .getByRole("button", { name: "消息操作" })
    .click();
  await page.getByRole("menuitem", { name: "重新发送", exact: true }).click();
  await expect(page.getByLabel("消息", { exact: true })).toHaveText(
    "停止这次回答",
  );
});

test("long replies start at the top and background messages preserve a reader's place", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1360, height: 600 });
  await control({ history: 12 });
  const answer = Array.from(
    { length: 18 },
    (_, index) => `第 ${index + 1} 项：资料已核对。`,
  ).join("\n\n");
  await control({ content: answer });
  await page.goto(url);
  const input = page.getByLabel("消息", { exact: true });
  const send = page.getByRole("button", { name: "发送", exact: true });
  await input.fill("长报告");
  await send.click();
  const last = page.getByLabel("Domos 的回复", { exact: true }).last();
  await expect(last.locator(".message-body")).toHaveText(answer, {
    timeout: 20_000,
  });
  await expect
    .poll(() =>
      last.evaluate((node) => {
        const viewport = node.closest(".transcript");
        if (!viewport) throw new Error("Transcript required");
        return Math.abs(
          node.getBoundingClientRect().top -
            viewport.getBoundingClientRect().top -
            Number.parseFloat(getComputedStyle(viewport).paddingTop),
        );
      }),
    )
    .toBeLessThan(2);
  await page.screenshot({ path: "test-results/chat-long-reply.png" });
  await page.locator(".transcript").evaluate((node) => {
    node.scrollTop = 50;
  });
  await expect(
    page.getByRole("button", { name: "返回最新", exact: true }),
  ).toBeVisible();
  await control({ content: "已完成。" });
  const rpc: RouterClient<AppRouter> = createORPCClient(
    new RPCLink({ url: `${url}/rpc` }),
  );
  const bot = (await rpc.bots.list())[0];
  if (!bot) throw new Error("Bot required");
  await rpc.send({
    botId: bot.id,
    text: "下一项任务",
    requestId: crypto.randomUUID(),
  });
  await expect
    .poll(async () => (await rpc.get({ botId: bot.id })).busy)
    .toBe(false);
  await expect
    .poll(() => page.locator(".transcript").evaluate((node) => node.scrollTop))
    .toBe(50);
  await expect(
    page.getByRole("button", { name: "有新消息", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "有新消息", exact: true }).click();
  await expect(page.getByLabel("Domos 的回复").last()).toHaveText("已完成。");
  await expect(page.getByLabel("Domos 的回复").last()).toBeInViewport();
  await page.reload();
  await expect(page.getByLabel("Domos 的回复").last()).toHaveText("已完成。");
});

test("background replies and reduced motion show complete messages without entry animation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = { hidden: false, arrivals: 0 };
    Object.assign(window, { deliveryMotion: state });
    Object.defineProperty(document, "hidden", { get: () => state.hidden });
    document.addEventListener("animationstart", (event) => {
      if (
        (state.hidden ||
          matchMedia("(prefers-reduced-motion: reduce)").matches) &&
        event.animationName === "message-in"
      )
        state.arrivals++;
    });
  });
  await page.goto(url);
  await control("gate");
  const input = page.getByLabel("消息", { exact: true });
  await input.fill("后台完成");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  await page.evaluate(() => {
    (
      window as unknown as { deliveryMotion: { hidden: boolean } }
    ).deliveryMotion.hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await control("release");
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(1);
  await page.evaluate(() => {
    (
      window as unknown as { deliveryMotion: { hidden: boolean } }
    ).deliveryMotion.hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await control("gate-tool");
  await control({
    responses: [
      {
        stopReason: "toolUse",
        content: [
          {
            type: "toolCall",
            id: crypto.randomUUID(),
            name: toolName,
            arguments: { text: "减少动画。" },
          },
        ],
      },
      { content: "减少动画。" },
    ],
  });
  await input.fill("减少动画");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const dot = page.locator(".typing-dots g").first();
  await expect(dot).toBeVisible();
  await expect(dot).toHaveCSS("animation-name", "none");
  await control("release");
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(2);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { deliveryMotion: { arrivals: number } })
            .deliveryMotion.arrivals,
      ),
    )
    .toBe(0);
});

test("large histories render a bounded window and retain the earlier reading anchor", async ({
  page,
}) => {
  await control({ history: 240 });
  await page.goto(url);
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(60);
  const older = page.getByRole("button", {
    name: "查看更早的消息",
    exact: true,
  });
  await older.scrollIntoViewIfNeeded();
  const first = page.getByLabel("你的消息", { exact: true }).first();
  const key = await first.getAttribute("data-transcript-key");
  const before = await first.boundingBox();
  await page.evaluate(() => {
    Reflect.set(window, "historyAnimations", []);
    const original = document.startViewTransition.bind(document);
    document.startViewTransition = (...args) => {
      (Reflect.get(window, "historyAnimations") as number[]).push(1);
      return original(...args);
    };
  });
  async function sampleAnchor() {
    await page.evaluate(() => {
      const viewport = document.querySelector(".transcript");
      if (!viewport) throw new Error("Transcript required");
      const bounds = viewport.getBoundingClientRect();
      const node = [
        ...document.querySelectorAll<HTMLElement>("[data-transcript-key]"),
      ].find((item) => item.getBoundingClientRect().bottom > bounds.top);
      if (!node) throw new Error("Visible message required");
      const top = node.getBoundingClientRect().top;
      const samples: number[] = [];
      Reflect.set(window, "anchorSamples", samples);
      Reflect.set(window, "samplingAnchor", true);
      const sample = () => {
        samples.push(
          node.isConnected
            ? Math.abs(node.getBoundingClientRect().top - top)
            : Infinity,
        );
        if (Reflect.get(window, "samplingAnchor"))
          requestAnimationFrame(() => setTimeout(sample, 0));
      };
      requestAnimationFrame(() => setTimeout(sample, 0));
    });
  }
  async function checkAnchor() {
    const samples = await page.evaluate(async () => {
      await new Promise(requestAnimationFrame);
      Reflect.set(window, "samplingAnchor", false);
      return Reflect.get(window, "anchorSamples") as number[];
    });
    expect(samples.length).toBeGreaterThan(1);
    expect(Math.max(...samples)).toBeLessThan(2);
  }
  await sampleAnchor();
  await older.click();
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(100);
  await checkAnchor();
  const retained = page.locator(`[data-transcript-key="${key}"]`);
  await expect
    .poll(async () =>
      Math.abs(((await retained.boundingBox())?.y ?? 0) - (before?.y ?? 0)),
    )
    .toBeLessThan(2);
  const input = page.getByLabel("消息", { exact: true });
  await input.fill("调宽时保留的草稿");
  for (const width of [1100, 1600, 1360]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(async () =>
        Math.abs(((await retained.boundingBox())?.y ?? 0) - (before?.y ?? 0)),
      )
      .toBeLessThan(2);
    await expect(input).toHaveText("调宽时保留的草稿");
    await expect(
      page.getByRole("button", { name: "返回最新", exact: true }),
    ).toBeVisible();
  }
  await older.scrollIntoViewIfNeeded();
  let pageReads = 0;
  const pending = Promise.withResolvers<void>();
  await page.route("**/rpc/get", async (route) => {
    pageReads++;
    await pending.promise;
    await route.continue();
  });
  await sampleAnchor();
  await older.click();
  await expect(older).toBeDisabled();
  await older.evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(() => pageReads).toBe(1);
  const rpc: RouterClient<AppRouter> = createORPCClient(
    new RPCLink({ url: `${url}/rpc` }),
  );
  const bot = (await rpc.bots.list())[0];
  if (!bot) throw new Error("Bot required");
  await control({ content: "补页期间的新回复" });
  await rpc.send({
    botId: bot.id,
    text: "后台新任务",
    requestId: crypto.randomUUID(),
  });
  await expect
    .poll(async () => (await rpc.get({ botId: bot.id })).busy)
    .toBe(false);
  pending.resolve();
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(120);
  await checkAnchor();
  await page.unroute("**/rpc/get");
  const imageReady = Promise.withResolvers<void>();
  await page.route("**/history-image.png", async (route) => {
    await imageReady.promise;
    await route.fulfill({ contentType: "image/png", body: png(320, 240) });
  });
  await sampleAnchor();
  await page
    .locator("[data-transcript-key]")
    .first()
    .evaluate((node) => {
      const image = new Image();
      image.src = "/history-image.png";
      image.dataset.testImage = "delayed";
      node.append(image);
    });
  imageReady.resolve();
  await page
    .locator('[data-test-image="delayed"]')
    .evaluate(async (image: HTMLImageElement) => {
      await image.decode();
    });
  await checkAnchor();
  await page.screenshot({ path: "tmp/file-ui/history-expanded.png" });
  expect(
    await page.evaluate(() => Reflect.get(window, "historyAnimations")),
  ).toEqual([]);
  await page.getByRole("button", { name: "有新消息", exact: true }).click();
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(60);
  await expect(page.getByLabel("Domos 的回复").last()).toContainText(
    "补页期间的新回复",
  );
  await page.screenshot({ path: "test-results/chat-history-window.png" });
});

test("history failures and timeouts release the request for an explicit retry", async ({
  page,
}) => {
  await control({ history: 240 });
  await page.goto(url);
  const earlier = page.getByRole("button", {
    name: "查看更早的消息",
    exact: true,
  });
  await earlier.scrollIntoViewIfNeeded();
  await earlier.click();
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(100);
  let reads = 0;
  await page.route("**/rpc/get", async (route) => {
    reads++;
    if (reads === 1) await route.abort();
    else await route.continue();
  });
  await earlier.scrollIntoViewIfNeeded();
  await earlier.click();
  await expect(page.getByRole("alert")).toHaveText(
    "历史消息读取失败，请重试。",
  );
  expect(reads).toBe(1);
  await page.screenshot({ path: "tmp/file-ui/history-failed.png" });
  await page
    .getByRole("button", { name: "重试读取历史消息", exact: true })
    .click();
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(120);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(reads).toBe(2);
  await page.unroute("**/rpc/get");
  await earlier.scrollIntoViewIfNeeded();
  await earlier.click();
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(100);
  await earlier.scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = (milliseconds) => {
      Reflect.set(window, "historyDeadline", milliseconds);
      return timeout(100);
    };
  });
  const held = Promise.withResolvers<void>();
  await page.route("**/rpc/get", async (route) => {
    await held.promise;
    await route.abort();
  });
  await earlier.click();
  await expect(page.getByRole("alert")).toHaveText(
    "历史消息读取超时，请重试。",
  );
  expect(
    await page.evaluate(() => Reflect.get(window, "historyDeadline")),
  ).toBe(30_000);
  await expect(
    page.getByRole("button", { name: "重试读取历史消息", exact: true }),
  ).toBeEnabled();
  held.resolve();
});

test("changing chats cancels an earlier-page read and keeps the new chat isolated", async ({
  page,
}) => {
  await control({ history: 240 });
  const rpc: RouterClient<AppRouter> = createORPCClient(
    new RPCLink({ url: `${url}/rpc` }),
  );
  await rpc.bots.create({ name: "研究员", requestId: crypto.randomUUID() });
  await page.goto(url);
  const contacts = page.getByRole("navigation", {
    name: "联系人",
    exact: true,
  });
  await contacts.getByRole("link", { name: /^Domos/ }).click();
  const earlier = page.getByRole("button", {
    name: "查看更早的消息",
    exact: true,
  });
  await earlier.scrollIntoViewIfNeeded();
  await earlier.click();
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(100);
  const release = Promise.withResolvers<void>();
  let reads = 0;
  await page.route("**/rpc/get", async (route) => {
    reads++;
    await release.promise;
    await route.continue();
  });
  await earlier.scrollIntoViewIfNeeded();
  await earlier.click();
  await expect.poll(() => reads).toBe(1);
  const cancelled = page.waitForEvent("requestfailed", (request) =>
    request.url().endsWith("/rpc/get"),
  );
  await contacts.getByRole("link", { name: /^研究员/ }).click();
  await cancelled;
  release.resolve();
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "查看更早的消息", exact: true }),
  ).toHaveCount(0);
});

test("published files wait for the complete reply", async ({ page }) => {
  await control("gate");
  const call = (name: string, args: Record<string, unknown>) => ({
    type: "toolCall",
    id: crypto.randomUUID(),
    name,
    arguments: args,
  });
  await control({
    responses: [
      {
        content: [call("write", { path: "report.md", content: "# Report" })],
        stopReason: "toolUse",
      },
      {
        content: [call("attach_file", { path: "report.md" })],
        stopReason: "toolUse",
      },
    ],
  });
  await page.goto(url);
  await page.getByLabel("消息", { exact: true }).fill("生成报告");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByRole("button", { name: "批准", exact: true }).click();
  await expect(page.locator(".typing-dots")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "另存为 report.md", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(0);
  await control("release");
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "另存为 report.md", exact: true }),
  ).toBeVisible();
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
  await input.press("x");
  await expect(input).toHaveText("中文输入\nx");
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
  await expect(page.getByLabel("消息", { exact: true })).toHaveText("");
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
  await expect(input).toHaveText("尚未发送的想法");
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(url);
  await expect(reopened.getByLabel("消息", { exact: true })).toHaveText(
    "尚未发送的想法",
  );
  await expect(reopened.getByLabel("你的消息")).toHaveCount(0);
});

test("drafts stay on their computer when the same address changes hosts", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "domos:composer:v1:1",
      JSON.stringify({ text: "原有草稿", attachments: [], pending: null }),
    );
  });
  await page.goto(url);
  const input = page.getByLabel("消息", { exact: true });
  await expect(input).toHaveText("原有草稿");
  await input.fill("ASUS 草稿");
  await page.route("**/rpc/computer/node", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.json.id = "another-computer";
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  await expect(input).toHaveText("");
  await input.fill("云电脑草稿");
  await page.unroute("**/rpc/computer/node");
  await page.reload();
  await expect(input).toHaveText("ASUS 草稿");
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
  await input.pressSequentially("下一条草稿");
  receipt.resolve();
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeVisible();
  await expect(input).toHaveText("下一条草稿");
  await page.reload();
  await expect(input).toHaveText("下一条草稿");
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
  await expect(input).toHaveText("保留在输入框");
  await expect(page.getByLabel("你的消息")).toHaveCount(0);
});

test("two windows can submit while a reply is active", async ({
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
  await page.getByLabel("消息", { exact: true }).fill("追加的消息");
  const submitted = page.waitForResponse((response) =>
    response.url().endsWith("/rpc/send"),
  );
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByLabel("消息", { exact: true })).toHaveText("");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await submitted;
  await page.unroute("**/rpc/send");
  await control("release");
  await page.bringToFront();
  await expect(page.getByLabel("你的消息")).toHaveText([
    /占用会话/,
    /追加的消息/,
  ]);
  await other.bringToFront();
  await expect(other.getByLabel("你的消息")).toHaveText([
    /占用会话/,
    /追加的消息/,
  ]);
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
    details
      .getByRole("radiogroup", { name: "操作审批", exact: true })
      .getByRole("radio", { name: "询问", exact: true }),
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
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(url);
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
  await other.goto(url);
  await openSettings(other);
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
  await openSettings(page);
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
    const send = page.getByRole("button", { name: "发送", exact: true });
    const colors = await send.evaluate((item) => {
      const sample = document.createElement("span");
      item.append(sample);
      sample.style.color = "var(--color-text)";
      const text = getComputedStyle(sample).color;
      sample.style.color = "var(--color-canvas)";
      const canvas = getComputedStyle(sample).color;
      sample.remove();
      return {
        text,
        canvas,
      };
    });
    await expect(send).toHaveCSS("background-color", colors.text);
    await expect(send).toHaveCSS("color", colors.canvas);
    await input.clear();
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
    .getByRole("button", { name: "发送", exact: true })
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

test("structured messages keep Markdown and private tool results across reloads", async ({
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
  await expect(page.locator(".typing-dots")).toBeVisible();
  await control("release");
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
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
    [1600, 13.5],
    [390, 13.5],
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
  await expectScale(27);
  await expect(input).toBeVisible();
  await input.fill("放大后仍可编辑。");
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeEnabled();
});

test("bundled Chinese and Latin faces render shared text weights", async ({
  page,
}) => {
  await control({ content: "中文消息与 Latin 文字。**重点内容**" });
  await page.goto(url);
  await page.getByLabel("消息", { exact: true }).fill("检查字体");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const paragraph = page.getByLabel("Domos 的回复").locator("p");
  await expect(paragraph).toContainText("中文消息与 Latin 文字。");
  await page.evaluate(() => document.fonts.ready);
  await expect(paragraph).toHaveCSS("font-weight", "400");
  await expect(paragraph.locator("strong")).toHaveCSS("font-weight", "500");
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

test("composer grows with wrapping and resets after clearing", async ({
  page,
}) => {
  await page.goto(url);
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
  await chooseDetail(await openDetails(page), "运行");
  const model = page.getByRole("combobox", { name: "模型", exact: true });
  const appearance = page.getByRole("combobox", { name: "外观", exact: true });
  await expect(model).toBeEnabled();
  await model.focus();
  await page.keyboard.press("Enter");
  const search = page.getByRole("searchbox", {
    name: "搜索模型…",
    exact: true,
  });
  await expect(search).toBeFocused();
  await search.click();
  await expect(search).toHaveCSS("outline-style", "none");
  await search.fill(crypto.randomUUID());
  await expect(page.getByText("没有找到模型", { exact: true })).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(0);
  await search.fill("测试模型二");
  await expect(page.getByRole("option")).toHaveCount(1);
  await page
    .getByRole("option", { name: "Pi · 测试模型二", exact: true })
    .click();
  await expect(model).toContainText("测试模型二");
  await expect(search).toHaveCount(0);
  await expect(model).toBeFocused();
  await model.click();
  await expect(search).toHaveValue("");
  await search.press("Escape");
  await expect(model).toBeFocused();
  const settings = await openSettings(page);
  await appearance.click();
  await expect(page.getByRole("option")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(appearance).toBeFocused();
  await settings.getByRole("button", { name: "返回对话", exact: true }).click();
  await expect(page.locator("select:visible")).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(page.locator(".workspace")).toHaveAttribute(
    "data-mobile",
    "true",
  );
  await model.click();
  const popup = page.locator(".model-selector-popup");
  await expect(popup).toBeVisible();
  const bounds = await popup.boundingBox();
  if (!bounds) throw new Error("Popup is not visible");
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(568);
  await page.screenshot({ path: "test-results/model-popup-mobile.png" });
  await page.mouse.click(2, 2);
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
  expect(received.x + received.width).toBeLessThanOrEqual(
    column.x + column.width,
  );
  expect(received.width).toBeLessThanOrEqual(720);
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
    await expect(page.locator(".settings-window")).toHaveCount(0);
    await search.click();
    await expect(search).toHaveCSS("outline-style", "none");
    await expect(page.locator(".sidebar-search")).toHaveCSS(
      "box-shadow",
      "none",
    );
    await expect(outgoing).toHaveCSS(
      "color",
      await incoming.evaluate((element) => getComputedStyle(element).color),
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
  page,
}) => {
  test.setTimeout(60_000);
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
  const primary = page.url();
  await input.fill("整理成报告");
  await page.reload();
  await expect(input).toHaveText("整理成报告");
  await expect(
    page.getByRole("button", { name: "移除文件 资料.txt", exact: true }),
  ).toBeVisible();
  await createBot(page, "其他助手");
  await expect(page.locator(".composer-attachments")).toHaveCount(0);
  await page.goto(primary);
  await expect(input).toHaveText("整理成报告");
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
  await page.getByRole("button", { name: "批准", exact: true }).click();
  await page.getByRole("button", { name: "批准", exact: true }).click();
  const report = page.getByRole("button", {
    name: "另存为 report.md",
    exact: true,
  });
  await expect(report).toBeVisible();
  await expect(send).toBeVisible();
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

test("attachment-only messages show cards directly for users and Bots", async ({
  page,
}) => {
  await page.goto(url);
  await attachFiles(page, [
    { name: "photo.png", mimeType: "image/png", buffer: png(320, 180) },
    {
      name: "report.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Report"),
    },
  ]);
  await expect(page.locator(".composer-attachments .attachment")).toHaveCount(
    2,
  );
  const files = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) =>
      key.startsWith("domos:composer:v2:"),
    );
    return JSON.parse(localStorage.getItem(key ?? "") ?? "{}").attachments as {
      path: string;
    }[];
  });
  await control({
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
    expect(
      await page
        .locator(".transcript")
        .evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await page.setViewportSize({ width: 1360, height: 900 });
  }
});

test("audio decode failures preserve the file download action", async ({
  page,
}) => {
  await control({ content: "已收到音频。" });
  await page.goto(url);
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
});

test("message media leads captions and bubble tails follow both themes", async ({
  page,
}) => {
  await control({ history: 40 });
  const imageReady = Promise.withResolvers<void>();
  await page.route(/\/files\/\d+\/[a-f0-9]{64}/, async (route) => {
    await imageReady.promise;
    await route.continue();
  });
  await control({ content: "图片和文档已收到。" });
  await page.goto(url);
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
  const outgoing = page
    .getByLabel("你的消息")
    .last()
    .locator(".message-bubble");
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
    const background = await outgoing.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    if (theme === "light") lightBackground = background;
    else expect(background).not.toBe(lightBackground);
    await expect(outgoing).toHaveCSS(
      "color",
      await incoming.evaluate((element) => getComputedStyle(element).color),
    );
    await expectTextContrast(page);
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(async () => {
        const attachments = await outgoing
          .locator(".attachments")
          .boundingBox();
        const caption = await outgoing.locator(".user-text").boundingBox();
        const frame = await outgoing.boundingBox();
        const image = await outgoing
          .locator(".image-thumbnail img")
          .boundingBox();
        const document = await outgoing.locator(".file-card").boundingBox();
        if (!frame || !image || !document || !caption)
          throw new Error("Message media missing");
        for (const media of [image, document]) {
          expect(media.x - frame.x).toBeGreaterThan(0);
          expect(media.x - frame.x).toBeLessThanOrEqual(4);
          expect(
            frame.x + frame.width - media.x - media.width,
          ).toBeLessThanOrEqual(4);
        }
        expect(image.y - frame.y).toBeLessThanOrEqual(4);
        expect(
          await outgoing.locator(".user-text").evaluate((element) => {
            const range = window.document.createRange();
            range.selectNodeContents(element);
            return range.getBoundingClientRect().x;
          }),
        ).toBeGreaterThan(image.x);
        expect(
          attachments &&
            caption &&
            attachments.y + attachments.height <= caption.y,
        ).toBeTruthy();
      }).toPass({ timeout: 5000 });
      for (const bubble of [incoming, outgoing]) {
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
  page,
}) => {
  await page.goto(url);
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
  const files = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) =>
      key.startsWith("domos:composer:v2:"),
    );
    return JSON.parse(localStorage.getItem(key ?? "") ?? "{}").attachments as {
      path: string;
    }[];
  });
  await control({
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
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
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
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
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

test("typing follows the Bot and failures retain their error message", async ({
  page,
}, testInfo) => {
  await page.goto(url);
  const primary = page.url();
  const input = page.getByLabel("消息", { exact: true });
  const send = page.getByRole("button", { name: "发送", exact: true });
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
  await page.getByRole("button", { name: "批准", exact: true }).click();
  await expect(page.locator(".typing-dots")).toBeVisible();
  await createBot(page, "旁观助手");
  await expect(page.locator(".typing-dots")).toHaveCount(0);
  await page.goto(primary);
  await expect(page.locator(".typing-dots")).toBeVisible();
  const stoppedReceipt = page.waitForResponse("**/rpc/stop");
  await page.getByRole("button", { name: "停止生成", exact: true }).click();
  await stoppedReceipt;
  await expect(page.locator(".typing-dots")).toHaveCount(0);
  await expect(page.locator('.task-notice[data-state="stopped"]')).toHaveCount(
    0,
  );
  await control({
    responses: [
      { content: "", stopReason: "error", errorMessage: "Connection error." },
      { content: "重试已恢复", stopReason: "stop" },
    ],
  });
  await input.pressSequentially("重试后继续");
  await send.click();
  await expect(page.locator(".messages").getByText("重试已恢复")).toBeVisible();
  const failure = page.locator(".task-notice .message-bubble");
  await expect(failure).toHaveCount(0);
  await control({ responses: [{ content: "", stopReason: "error" }] });
  await input.fill("再次生成");
  await send.click();
  await expect(failure).toHaveCount(1);
  await expect(failure).toContainText("回复失败，原因待确认");
  await expect(failure).toContainText(/〔\d+:\d+〕/);
  await expect(failure.getByRole("alert")).toBeVisible();
  await expect(failure.locator('svg[aria-hidden="true"]')).toHaveCount(1);
  const errorText = await failure.innerText();
  const port = Number(new URL(url).port);
  await stop();
  await start(port);
  await page.reload();
  await expect(send).toBeVisible();
  await expect(failure).toHaveCount(1);
  await expect(failure).toHaveText(errorText);
  await page
    .locator("#bot-details")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(failure).toBeVisible();
      await expectTextContrast(page);
      await page.screenshot({
        path: testInfo.outputPath(`failure-${colorScheme}-${width}.png`),
        animations: "disabled",
      });
    }
  }
  await expect(page.getByRole("button", { name: /^下载/ })).toHaveCount(0);
  await expect(page.locator('.task-notice[data-state="stopped"]')).toHaveCount(
    0,
  );
  await page
    .getByLabel("你的消息")
    .last()
    .getByRole("button", { name: "消息操作" })
    .click();
  await page.getByRole("menuitem", { name: "重新发送", exact: true }).click();
  await expect(input).toHaveText("再次生成");
});

test("chat keeps sending available while the Bot is working", async ({
  page,
}) => {
  await control("gate-tool");
  await control({
    responses: [
      {
        stopReason: "toolUse",
        content: [
          { type: "text", text: "Checking sources" },
          {
            type: "toolCall",
            id: crypto.randomUUID(),
            name: toolName,
            arguments: { text: "Waiting" },
          },
        ],
      },
      { content: "All requests received" },
    ],
  });
  await page.goto(url);
  const input = page.getByLabel("消息", { exact: true });
  const send = page.getByRole("button", { name: "发送", exact: true });
  await input.fill("first");
  await send.click();
  await expect(page.locator(".typing-dots")).toBeVisible();
  await expect(page.getByLabel("Domos 的回复")).toHaveText("Checking sources");
  await input.pressSequentially("second");
  await expect(send).toBeEnabled();
  await send.click();
  await expect(input).toHaveText("");
  await input.pressSequentially("third");
  await send.click();
  await expect(input).toHaveText("");
  await expect(
    page.locator(".message").filter({ hasNot: page.locator(".typing-dots") }),
  ).toHaveText([/first/, "Checking sources", /second/, /third/]);
  await expect(page.locator(".typing-dots")).toHaveCount(1);
  const typingPosition = await page.locator(".typing-dots").boundingBox();
  const latestPosition = await page.getByLabel("你的消息").last().boundingBox();
  expect(
    typingPosition &&
      latestPosition &&
      typingPosition.y >= latestPosition.y + latestPosition.height,
  ).toBe(true);
  const selector = (await openDetails(page)).getByRole("combobox", {
    name: "模型",
    exact: true,
  });
  await expect(selector).toBeDisabled();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "停止生成", exact: true }),
  ).toBeVisible();
  await control("release");
  await expect(page.getByLabel("你的消息")).toHaveText([
    /first/,
    /second/,
    /third/,
  ]);
  await expect(page.getByLabel("Domos 的回复").last()).toContainText(
    "All requests received",
  );
  const grouped = page.locator(".message.user + .message.user").first();
  await expect(grouped).toBeVisible();
  expect(
    await grouped.evaluate(
      (element) =>
        element.getBoundingClientRect().top -
        (element.previousElementSibling?.getBoundingClientRect().bottom ?? 0),
    ),
  ).toBe(12);
  const reply = page.locator(".message.user + .message.assistant").first();
  expect(
    await reply.evaluate(
      (element) =>
        element.getBoundingClientRect().top -
        (element.previousElementSibling?.getBoundingClientRect().bottom ?? 0),
    ),
  ).toBe(12);
  await expect(page.locator(".task-notice")).toHaveCount(0);
  await page.screenshot({ path: "test-results/chat-continuous-input.png" });
});

test("message insertion moves typing continuously and completion fades it out", async ({
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
            name: toolName,
            arguments: { text: "已核对" },
          },
        ],
      },
      {
        stopReason: "toolUse",
        content: [
          { type: "text", text: "正在核对资料。" },
          {
            type: "toolCall",
            id: crypto.randomUUID(),
            name: toolName,
            arguments: { text: "已核对" },
          },
        ],
      },
      {
        content: [
          {
            type: "thinking",
            thinking: "资料已经核对。现在整理来源与结果，再提交完整回复。",
            thinkingSignature: "signature",
          },
          { type: "text", text: "核对完成。" },
        ],
      },
    ],
  });
  await page.goto(url);
  const input = page.getByLabel("消息", { exact: true });
  await input.fill("核对资料");
  await input.press("Enter");
  const typing = page.locator(".typing-row");
  await expect(typing).toBeVisible();
  await page.evaluate(() => document.activeViewTransition?.finished);
  const before = await typing.boundingBox();
  if (!before) throw new Error("Typing bubble required");
  type Sample = {
    pseudo: string;
    y: number;
    opacity: number;
    time: number;
    exit: boolean;
  };
  await page.evaluate((width) => {
    const state = { frames: [] as Sample[], running: true };
    const sampled = new WeakSet<Animation>();
    Object.assign(window, { messageMotion: state });
    const sample = () => {
      for (const animation of document.getAnimations()) {
        const pseudo = (animation.effect as KeyframeEffect | null)
          ?.pseudoElement;
        if (!pseudo) continue;
        const style = getComputedStyle(document.documentElement, pseudo);
        const exit =
          (animation as CSSAnimation).animationName === "message-out";
        if (
          !sampled.has(animation) &&
          (exit ||
            (pseudo.startsWith("::view-transition-group(") &&
              Math.abs(Number.parseFloat(style.width) - width) < 1))
        ) {
          sampled.add(animation);
          animation.pause();
          const duration = Number(animation.effect?.getTiming().duration);
          for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
            animation.currentTime = duration * progress;
            const style = getComputedStyle(document.documentElement, pseudo);
            state.frames.push({
              pseudo,
              y: new DOMMatrix(style.transform).m42,
              opacity: Number(style.opacity),
              time: duration * progress,
              exit,
            });
          }
          animation.finish();
        }
      }
      if (state.running) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, before.width);
  await control("release");
  await control("gate-tool");
  await expect(page.getByLabel("Domos 的回复")).toHaveText("正在核对资料。");
  await page.evaluate(() => document.activeViewTransition?.finished);
  const after = await typing.boundingBox();
  if (!after) throw new Error("Typing bubble required");
  expect(after.y).toBeGreaterThan(before.y);
  await control("release");
  await expect(page.getByLabel("Domos 的回复").last()).toHaveText("核对完成。");
  await page.evaluate(() => document.activeViewTransition?.finished);
  await expect(typing).toHaveCount(0);
  const frames = await page.evaluate(() => {
    const state = (
      window as unknown as {
        messageMotion: { frames: Sample[]; running: boolean };
      }
    ).messageMotion;
    state.running = false;
    return state.frames;
  });
  const moving = frames.filter(
    (frame) => !frame.exit && frame.y > before.y && frame.y < after.y,
  );
  expect(moving.length).toBeGreaterThan(2);
  for (let index = 1; index < moving.length; index++)
    expect(moving[index]?.y).toBeGreaterThanOrEqual(
      (moving[index - 1]?.y ?? 0) - 0.5,
    );
  const fading = frames.filter((frame) => frame.exit);
  expect(fading.length).toBeGreaterThan(2);
  expect(fading.at(-1)?.opacity).toBeLessThan(fading[0]?.opacity ?? 0);
  await test.info().attach("message-motion", {
    body: JSON.stringify(frames),
    contentType: "application/json",
  });
});

test("typing dots share the avatar color and follow complete messages", async ({
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
  await page.getByLabel("消息", { exact: true }).fill("核对并整理资料");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const typing = page.getByRole("status", {
    name: "Domos 正在回复",
    exact: true,
  });
  const replies = page.getByLabel("Domos 的回复");
  await expect(replies).toHaveText(["先核对资料，再整理结果。"]);
  await expect(typing).toBeVisible();
  await expect(typing).toHaveText("");
  await expect(typing.locator("..")).toHaveClass("message-bubble");
  await expect(typing.locator("svg")).toHaveCount(1);
  await expect(typing.locator("svg circle")).toHaveCount(3);
  await expect(typing).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const indicator = await typing.boundingBox();
  expect(indicator && indicator.width <= 48 && indicator.height <= 28).toBe(
    true,
  );
  await expect(page.getByRole("log").locator("details")).toHaveCount(0);
  await expect(page.locator(".composer-area .bot-avatar")).toHaveCount(0);
  await expect(
    page.getByText("核对资料的内容与来源。", { exact: true }),
  ).toHaveCount(0);
  const position = await typing.boundingBox();
  const reply = await replies.boundingBox();
  expect(position && reply && position.y >= reply.y + reply.height).toBe(true);
  const seed = await page
    .locator(".chat-identity .bot-avatar")
    .getAttribute("data-seed");
  const color = characterIdentity(seed ?? "").color;
  const rgb = [1, 3, 5].map((index) =>
    Number.parseInt(color.slice(index, index + 2), 16),
  );
  await expect(typing).toHaveCSS("color", `rgb(${rgb.join(", ")})`);
  const animation = await typing.locator("g").evaluateAll((nodes) =>
    nodes.map((node) => ({
      name: getComputedStyle(node).animationName,
      delay: Number.parseFloat(getComputedStyle(node).animationDelay),
      fill: getComputedStyle(node.querySelector("circle") as Element).fill,
    })),
  );
  expect(animation.map((item) => item.name)).toEqual([
    "typing-wave",
    "typing-wave",
    "typing-wave",
  ]);
  const [first, second, third] = animation;
  if (!first || !second || !third) throw new Error("Three dots required");
  expect([first.delay, second.delay, third.delay]).toEqual([0, 0.18, 0.36]);
  expect(new Set(animation.map((item) => item.fill)).size).toBe(1);
  const wave = await typing.locator("g").evaluateAll((nodes) =>
    nodes.map((node) => {
      const animation = node.getAnimations()[0];
      if (!animation) throw new Error("Typing animation missing");
      const currentTime = animation.currentTime;
      animation.pause();
      const samples = [0, 390, 780].map((time) => {
        animation.currentTime =
          time +
          Number.parseFloat(getComputedStyle(node).animationDelay) * 1000;
        const style = getComputedStyle(node);
        return {
          y: new DOMMatrix(style.transform).m42,
          opacity: Number(style.opacity),
        };
      });
      animation.currentTime = currentTime;
      animation.play();
      return samples;
    }),
  );
  for (const samples of wave) {
    for (const [index, expected] of [
      { y: 0, opacity: 0.4 },
      { y: -4, opacity: 1 },
      { y: 0, opacity: 0.4 },
    ].entries()) {
      expect(samples[index]?.y).toBeCloseTo(expected.y, 3);
      expect(samples[index]?.opacity).toBeCloseTo(expected.opacity, 3);
    }
  }
  const surroundingAnimations = await typing.evaluateHandle((element) =>
    document.getAnimations().filter((animation) => {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      if (!(target instanceof Element) || element.contains(target))
        return false;
      animation.pause();
      return true;
    }),
  );
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const performance = await page.context().newCDPSession(page);
  await performance.send("Performance.enable");
  const before = await performance.send("Performance.getMetrics");
  const sampleFrames = () =>
    page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const samples: number[] = [];
          let start = 0;
          let previous = 0;
          const sample = (time: number) => {
            if (!start) start = time;
            if (previous) samples.push(time - previous);
            previous = time;
            if (time - start < 1000) requestAnimationFrame(sample);
            else resolve(samples);
          };
          requestAnimationFrame(sample);
        }),
    );
  const intervals = await sampleFrames();
  const after = await performance.send("Performance.getMetrics");
  await typing.evaluate((element) => {
    for (const animation of element.getAnimations({ subtree: true }))
      animation.pause();
  });
  const idleIntervals = await sampleFrames();
  await typing.evaluate((element) => {
    for (const animation of element.getAnimations({ subtree: true }))
      animation.play();
  });
  const metric = (metrics: typeof before, name: string) =>
    metrics.metrics.find((item) => item.name === name)?.value ?? 0;
  const layouts = metric(after, "LayoutCount") - metric(before, "LayoutCount");
  const layoutMs =
    (metric(after, "LayoutDuration") - metric(before, "LayoutDuration")) * 1000;
  const styleMs =
    (metric(after, "RecalcStyleDuration") -
      metric(before, "RecalcStyleDuration")) *
    1000;
  const p95 = [...intervals].sort((a, b) => a - b)[
    Math.floor(intervals.length * 0.95)
  ];
  const idleP95 = [...idleIntervals].sort((a, b) => a - b)[
    Math.floor(idleIntervals.length * 0.95)
  ];
  if (idleP95 === undefined) throw new Error("No idle frames were recorded");
  console.log("typing frames", { p95, idleP95, layoutMs, styleMs });
  await performance.detach();
  await test.info().attach("typing-performance", {
    body: JSON.stringify({
      layouts,
      layoutMs,
      styleMs,
      p95,
      idleP95,
      intervals,
      idleIntervals,
    }),
    contentType: "application/json",
  });
  await surroundingAnimations.evaluate((animations) => {
    for (const animation of animations) animation.play();
  });
  await surroundingAnimations.dispose();
  expect((layoutMs + styleMs) / intervals.length).toBeLessThan(1);
  for (const [theme, label] of [
    ["dark", "深色"],
    ["light", "浅色"],
  ] as const) {
    await chooseAppearance(page, label);
    await expect(typing).toBeVisible();
    const textHeight = await replies
      .locator(".message-bubble")
      .evaluate((node) => node.getBoundingClientRect().height);
    await expect(typing.locator("..")).toHaveCSS("height", `${textHeight}px`);
    await expect(typing.locator("svg")).toHaveCSS("height", "28px");
    await expect(typing.locator("svg")).toHaveCSS("width", "48px");
    await page.screenshot({ path: `test-results/typing-${theme}.png` });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const dot of await typing.locator("g").all())
    await expect(dot).toHaveCSS("animation-name", "none");
  await page.emulateMedia({ forcedColors: "active" });
  await expect(typing).toBeVisible();
  await page.emulateMedia({
    forcedColors: "none",
    reducedMotion: "no-preference",
  });
  await page.reload();
  await expect(replies).toHaveText(["先核对资料，再整理结果。"]);
  await expect(typing).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: "test-results/typing-mobile.png" });
  await control("release");
  await expect(replies).toHaveCount(2);
  await expect(replies.last().locator("strong")).toHaveText("整理完成。");
  const positions = await replies.last().evaluate(async (node) => {
    const viewport = node.closest(".transcript");
    if (!viewport) throw new Error("Transcript required");
    const samples: number[] = [];
    for (let index = 0; index < 20; index++) {
      await new Promise(requestAnimationFrame);
      samples.push((node as HTMLElement).offsetTop - viewport.scrollTop);
    }
    return samples;
  });
  expect(Math.max(...positions) - Math.min(...positions)).toBeLessThanOrEqual(
    1,
  );
  await expect(typing).toHaveCount(0);
  await page.reload();
  await expect(replies).toHaveCount(2);
});
test("native questions use the shared card and native replies persist", async ({
  page,
}) => {
  await control({
    responses: [
      {
        stopReason: "toolUse",
        content: [
          { type: "text", text: "正在核对资料。" },
          {
            type: "toolCall",
            id: crypto.randomUUID(),
            name: "ask_user",
            arguments: {
              questions: [
                { question: "你要哪种结果？", options: ["简短", "详细"] },
                { question: "说明用途" },
              ],
            },
          },
        ],
      },
      { content: "已按你的选择完成。" },
    ],
  });
  await page.goto(url);
  await page.getByLabel("消息", { exact: true }).fill("整理资料，先问我选择");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const replies = page.getByLabel("Domos 的回复", { exact: true });
  await expect(replies).toHaveText(["正在核对资料。"]);
  const choice = page.getByRole("region", {
    name: "你要哪种结果？",
    exact: true,
  });
  await expect(choice).toBeVisible();
  await expect(page.locator(".typing-row")).toHaveCount(0);
  await expect(page.locator(".composer-area .interaction-card")).toHaveCount(0);
  await expect(choice.getByRole("combobox")).toHaveCount(0);
  await page.reload();
  await choice.getByRole("button", { name: "A 简短", exact: true }).click();
  await expect(choice.getByRole("status")).toHaveText("已回答");
  await page
    .getByRole("region", { name: "说明用途", exact: true })
    .getByRole("textbox", { name: "你的回答", exact: true })
    .fill("团队周报");
  await page.screenshot({
    path: "test-results/native-question.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "发送回答", exact: true }).click();
  await expect(replies).toHaveText(["正在核对资料。", "已按你的选择完成。"]);
  await expect(
    page.locator('.interaction-card[data-state="pending"]'),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeVisible();
  const port = Number(new URL(url).port);
  await stop();
  await start(port);
  await page.reload();
  await expect(replies).toHaveText(["正在核对资料。", "已按你的选择完成。"]);
  await expect(choice.getByRole("status")).toHaveText("已回答");
  await expect(choice.locator(".interaction-card")).toHaveCount(0);
  await choice.getByRole("button").click();
  const answered = page.getByRole("dialog", {
    name: "你要哪种结果？",
    exact: true,
  });
  await expect(
    answered.getByRole("button", { name: "A 简短", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await control({
    responses: [
      {
        stopReason: "toolUse",
        content: [
          {
            type: "toolCall",
            id: crypto.randomUUID(),
            name: "ask_user",
            arguments: { questions: [{ question: "继续吗？" }] },
          },
        ],
      },
      { content: "提问已取消。" },
    ],
  });
  await page.getByLabel("消息", { exact: true }).fill("再问一次");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page
    .getByRole("region", { name: "继续吗？", exact: true })
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeVisible();
  const latest = page.getByRole("button", { name: /^(返回最新|有新消息)$/ });
  await expect(
    replies.filter({ hasText: "提问已取消。" }).or(latest).first(),
  ).toBeVisible();
  if (await latest.isVisible()) await latest.click();
  await expect(replies.last()).toHaveText("提问已取消。");
  await expect(
    page.locator('.interaction-card[data-state="pending"]'),
  ).toHaveCount(0);
  await control({
    content: [
      {
        type: "toolCall",
        id: crypto.randomUUID(),
        name: "ask_user",
        arguments: { questions: [{ question: "停止前的问题" }] },
      },
    ],
    stopReason: "toolUse",
  });
  await page.getByLabel("消息", { exact: true }).fill("等待我的回答");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const stopped = page.getByRole("region", {
    name: "停止前的问题",
    exact: true,
  });
  await expect(stopped).toBeVisible();
  await page.getByRole("button", { name: "停止生成", exact: true }).click();
  await expect(stopped.getByRole("status")).toHaveText("已失效");
  await page.reload();
  await expect(stopped.getByRole("status")).toHaveText("已失效");
});

test("Bot identity stays consistent and image previews work in drafts and history", async ({
  page,
}) => {
  await page.goto(url);
  await chooseAppearance(page, "浅色");
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page.getByRole("menuitem", { name: "新建 Bot", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建 Bot", exact: true });
  const avatar = dialog.locator(".avatar-editor > .bot-avatar");
  const initial = await avatar.getAttribute("data-seed");
  await dialog.getByRole("button", { name: "选择头像", exact: true }).click();
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
  await page.keyboard.press("Escape");
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
  const selected = page.locator(
    '.contact-row[aria-current="page"] .bot-avatar',
  );
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
    page.getByRole("button", { name: "添加内容", exact: true }),
  ).toBeEnabled();
  await attachFiles(page, {
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
  await expect(page.locator(".composer-attachments")).toHaveCount(0);
  await retry.click();
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("你的消息", { exact: true })).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "另存为 source.txt", exact: true }),
  ).toHaveCount(1);
  await expect(page.locator(".composer-attachments")).toHaveCount(0);
});

for (const method of ["click", "Enter"] as const) {
  test(`sending attachments clears the editor before the receipt via ${method}`, async ({
    page,
  }) => {
    await page.goto(url);
    await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
    await attachFiles(page, [
      {
        name: "source.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Source"),
      },
      { name: "image.png", mimeType: "image/png", buffer: png(1, 1) },
    ]);
    await expect(
      page.getByRole("button", { name: "移除文件 source.txt" }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "移除文件 image.png" }),
    ).toBeEnabled();
    const receipt = Promise.withResolvers<void>();
    await page.route("**/rpc/send", async (route) => {
      await receipt.promise;
      await route.continue();
    });
    const input = page.getByLabel("消息", { exact: true });
    if (method === "click") await input.fill("处理附件");
    try {
      if (method === "click")
        await page.getByRole("button", { name: "发送", exact: true }).click();
      else await input.press("Enter");
      await expect(input).toHaveText("");
      const outgoing = page.getByLabel("你的消息", { exact: true });
      await expect(
        outgoing.getByRole("button", {
          name: "另存为 source.txt",
          exact: true,
        }),
      ).toBeVisible();
      await expect(outgoing.locator("img")).toHaveJSProperty("naturalWidth", 1);
      await expect(page.locator(".composer-attachments")).toHaveCount(0);
      await expect(page.locator(".typing-dots")).toBeVisible();
      await input.fill("下一条草稿");
    } finally {
      receipt.resolve();
    }
    await expect(
      page.getByRole("button", { name: "发送", exact: true }),
    ).toBeVisible();
    await expect(input).toHaveText("下一条草稿");
    await page.reload();
    await expect(input).toHaveText("下一条草稿");
    await expect(page.locator(".composer-attachments")).toHaveCount(0);
  });
}

test("a send receipt preserves the draft after switching away and back", async ({
  page,
}) => {
  await page.goto(url);
  await createBot(page, "其他助手");
  await page.getByRole("link", { name: "Domos", exact: true }).click();
  await attachFiles(page, {
    name: "source.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Source"),
  });
  await expect(
    page.getByRole("button", { name: "移除文件 source.txt" }),
  ).toBeEnabled();
  const receipt = Promise.withResolvers<void>();
  await page.route("**/rpc/send", async (route) => {
    await receipt.promise;
    await route.continue();
  });
  const input = page.getByLabel("消息", { exact: true });
  try {
    await input.fill("处理文件");
    await input.press("Enter");
    await expect(
      page.getByRole("button", { name: "发送中…", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "其他助手", exact: true }).click();
    await input.fill("其他机器人的草稿");
    await page.getByRole("link", { name: "Domos", exact: true }).click();
    await input.fill("下一条草稿");
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    receipt.resolve();
  }
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".composer-attachments")).toHaveCount(0);
  await expect(input).toHaveText("下一条草稿");
  await page.reload();
  await expect(input).toHaveText("下一条草稿");
  await page.getByRole("link", { name: "其他助手", exact: true }).click();
  await expect(input).toHaveText("其他机器人的草稿");
});

for (const nextDraft of ["", "下一条草稿"]) {
  test(`a rejected attachment send restores the editor with next draft '${nextDraft}'`, async ({
    page,
  }) => {
    await page.goto(url);
    await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
    await attachFiles(page, {
      name: "source.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Source"),
    });
    await expect(
      page.getByRole("button", { name: "移除文件 source.txt" }),
    ).toBeEnabled();
    const receipt = Promise.withResolvers<void>();
    await page.route("**/rpc/send", async (route) => {
      await receipt.promise;
      await route.fulfill({
        status: 409,
        json: {
          json: { code: "CONFLICT", message: "任务未接收", status: 409 },
        },
      });
    });
    const input = page.getByLabel("消息", { exact: true });
    try {
      await input.fill("处理文件");
      await input.press("Enter");
      await expect(page.locator(".composer-attachments")).toHaveCount(0);
      await input.fill(nextDraft);
    } finally {
      receipt.resolve();
    }
    await expect(page.getByRole("alert")).toContainText("会话正在回复");
    await expect(input).toHaveText(nextDraft || "处理文件");
    await expect(
      page.getByRole("button", { name: "移除文件 source.txt" }),
    ).toBeEnabled();
    await expect(page.getByLabel("你的消息", { exact: true })).toHaveCount(0);
  });
}

test("computer details share live directory status and recover a failed refresh", async ({
  page,
}) => {
  await page.goto(url);
  const details = await openDetails(page);
  await chooseDetail(details, "电脑");
  const computer = details.getByRole("region", {
    name: "工作目录与权限",
    exact: true,
  });
  await computer.locator("summary", { hasText: "高级设置" }).click();
  await expect(
    computer.getByRole("combobox", { name: "执行环境", exact: true }),
  ).toContainText("此电脑");
  await expect(computer.getByRole("button", { name: "启动电脑" })).toHaveCount(
    0,
  );
  await computer.getByRole("button", { name: "电脑设置", exact: true }).click();
  const settings = page.getByRole("main", {
    name: "设置",
    exact: true,
  });
  await settings.locator(".settings-group > .disclosure > summary").click();
  await page.route("**/rpc/computer/list", (route) => route.abort("failed"));
  await settings.getByRole("button", { name: "刷新电脑状态" }).click();
  await expect(settings.getByRole("alert")).toBeVisible();
  await page.unroute("**/rpc/computer/list");
  await settings.getByRole("button", { name: "刷新电脑状态" }).click();
  await expect(settings.getByRole("alert")).toHaveCount(0);
  await settings.getByRole("button", { name: "返回对话", exact: true }).click();
  await page.screenshot({ path: "test-results/computer-light.png" });
  await chooseAppearance(page, "深色");
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(
    computer.getByRole("button", { name: "电脑设置", exact: true }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/computer-mobile-dark.png" });
  await computer.getByRole("button", { name: "电脑设置", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(details).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Bot详情", exact: true }),
  ).toBeFocused();
});

test("composer menu adds task materials, keeps drafts, and fits both themes", async ({
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
    new RPCLink({ url: `${url}/rpc` }),
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
  await page.goto(url);
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
  await control({ content: "材料已处理。" });
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
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(url);
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

test("file upload retry keeps its identity and cancellation releases the draft", async ({
  page,
}) => {
  await page.goto(url);
  await expect(
    page.getByRole("button", { name: "添加内容", exact: true }),
  ).toBeEnabled();
  let lost = false;
  await page.route("**/files/*/upload?*", async (route) => {
    if (lost) return route.continue();
    lost = true;
    await route.fetch();
    await route.abort("failed");
  });
  await attachFiles(page, {
    name: "retry.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Draft source"),
  });
  await expect(page.locator(".composer-upload")).toContainText("上传失败");
  await page
    .locator(".composer-upload")
    .getByRole("button", { name: "重试", exact: true })
    .click();
  const remove = page.getByRole("button", {
    name: "移除文件 retry.txt",
    exact: true,
  });
  await expect(remove).toBeVisible();
  await remove.click();
  await expect(page.locator(".composer-attachments")).toHaveCount(0);
  const release = Promise.withResolvers<void>();
  const reached = Promise.withResolvers<void>();
  await page.unroute("**/files/*/upload?*");
  await page.route("**/files/*/upload?*", async (route) => {
    const response = await route.fetch();
    reached.resolve();
    await release.promise;
    await route.fulfill({ response });
  });
  await attachFiles(page, {
    name: "cancel.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Cancelled source"),
  });
  await reached.promise;
  await page
    .getByRole("button", { name: "取消上传 cancel.txt", exact: true })
    .click();
  release.resolve();
  await expect(page.locator(".composer-attachments")).toHaveCount(0);
  await page.getByLabel("消息", { exact: true }).fill("A regular message");
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeEnabled();
});

test("action drafts edit the confirmed version and keep previews across themes and reload", async ({
  page,
}, testInfo) => {
  worker.send({
    approval: {
      id: "draft-ui",
      title: "发送团队更新",
      detail: "",
      kind: "question",
      confirmLabel: "发送",
      draft: {
        body: `## 本周进展\n\n${"已完成本周的更新。\n\n".repeat(45)}`,
        editable: true,
        fields: [
          {
            id: "to",
            label: "收件人",
            value: "team@example.com",
            editable: true,
          },
          { id: "subject", label: "主题", value: "团队更新", editable: true },
        ],
      },
    },
  });
  await page.goto(url);
  const card = page.getByRole("region", { name: "发送团队更新", exact: true });
  await expect(card).toBeVisible();
  for (const theme of ["浅色", "深色"]) {
    await chooseAppearance(page, theme);
    await expect(
      card.getByRole("button", { name: "发送", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`draft-${theme}.png`) });
  }
  const details = page.getByRole("complementary", { name: /的详情$/ });
  if (await details.isVisible())
    await details.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(details).toBeHidden();
  await page.setViewportSize({ width: 390, height: 760 });
  await expect(page.locator(".workspace")).toHaveAttribute(
    "data-mobile",
    "true",
  );
  const inspector = page.getByRole("dialog", { name: "Bot详情", exact: true });
  await page.keyboard.press("Escape");
  await expect(inspector).toBeHidden();
  const bounds = await card.boundingBox();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);
  await card.getByRole("button", { name: "修改", exact: true }).click();
  await card
    .getByRole("textbox", { name: "收件人", exact: true })
    .fill("review@example.com");
  await card
    .getByRole("textbox", { name: "正文", exact: true })
    .fill("这是修改后的确认稿。");
  await card.getByRole("button", { name: "预览", exact: true }).click();
  await expect(card).toContainText("这是修改后的确认稿。");
  await card.getByRole("button", { name: "发送", exact: true }).click();
  await expect(card.getByRole("status")).toHaveText("已确认");

  await page.reload();
  await expect(card).toContainText("review@example.com");
  await expect(card).toContainText("这是修改后的确认稿。");
  await expect(
    card.getByRole("button", { name: "发送", exact: true }),
  ).toHaveCount(0);
});

test("secure credential cards save privately, retry failures and cancel in chat", async ({
  page,
}, testInfo) => {
  const rpc: RouterClient<AppRouter> = createORPCClient(
    new RPCLink({ url: `${url}/rpc` }),
  );
  const bot = (await rpc.bots.list())[0];
  if (!bot) throw new Error("Bot required");
  let connection = await rpc.mcp.save({
    id: crypto.randomUUID(),
    revision: 0,
    name: "Notes",
    computerId: "local",
    enabled: true,
    config: { transport: "http", url: "https://example.com/mcp", headers: {} },
  });
  connection = await rpc.mcp.grant({
    id: connection.id,
    revision: connection.revision,
    grants: [{ botId: bot.id, tools: null }],
  });
  const request = {
    id: "credential-ui",
    title: "连接 Notes",
    detail: "保存这份笔记需要服务授权。",
    kind: "question",
    credential: {
      connectionId: connection.id,
      revision: connection.revision,
      mode: "secret",
      fields: [{ name: "Authorization", label: "API Key", prefix: "Bearer " }],
    },
  };
  worker.send({ approval: request });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto(url);
  const card = page.getByRole("region", { name: "连接 Notes", exact: true });
  await expect(card).toBeVisible();
  await card.getByLabel("API Key", { exact: true }).fill("private-ui-value");
  await expect(card.getByLabel("API Key", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
  await page.route("**/rpc/engines/credentials", async (route) => {
    await route.abort();
    await page.unroute("**/rpc/engines/credentials");
  });
  await card.getByRole("button", { name: "保存并继续", exact: true }).click();
  await expect(card.getByRole("alert")).toBeVisible();
  await expect(card.getByLabel("API Key", { exact: true })).toHaveValue(
    "private-ui-value",
  );
  await page.screenshot({
    path: testInfo.outputPath("credential-dark-narrow.png"),
  });
  const answered = once(worker, "message");
  await card.getByRole("button", { name: "保存并继续", exact: true }).click();
  expect(JSON.stringify(await answered)).not.toContain("private-ui-value");
  await expect(card.getByRole("status")).toHaveText("已配置");
  await expect(card.locator("input")).toHaveCount(0);
  expect(JSON.stringify(await rpc.get({ botId: bot.id }))).not.toContain(
    "private-ui-value",
  );
  await page.reload();
  await expect(card.getByRole("status")).toHaveText("已配置");
  expect(await page.locator("body").textContent()).not.toContain(
    "private-ui-value",
  );
  worker.send({ approval: { ...request, id: "credential-cancel" } });
  const pending = page.locator('.action-card[data-state="pending"]');
  await expect(pending).toBeVisible();
  const cancelled = once(worker, "message");
  await pending.getByRole("button", { name: "取消", exact: true }).click();
  expect(JSON.stringify(await cancelled)).toContain('"allow":false');
  await expect(pending).toHaveCount(0);
});

test("material menus keep descriptions and long catalogs within the viewport", async ({
  page,
}, testInfo) => {
  const names = Array.from(
    { length: 20 },
    (_, index) => `project-${index}-review-documentation-and-current-workspace`,
  );
  await control({
    nativeSkills: names.map((name) => ({
      name,
      description: "检查项目文件、测试结果和当前修改。".repeat(12),
      path: `/project/skills/${name}/SKILL.md`,
      source: "project",
    })),
  });
  await page.goto(url);
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

test("material pickers show native sources and keep MCP references separate from grants", async ({
  page,
}) => {
  const rpc: RouterClient<AppRouter> = createORPCClient(
    new RPCLink({ url: `${url}/rpc` }),
  );
  const bot = (await rpc.bots.list())[0];
  if (!bot) throw new Error("Missing Bot");
  const skill = await rpc.work.skills.save({
    botId: bot.id,
    id: crypto.randomUUID(),
    revision: 0,
    requestId: crypto.randomUUID(),
    content: "---\nname: report\ndescription: Report\n---\nOriginal procedure",
  });
  await rpc.work.skills.enable({
    botId: bot.id,
    id: skill.id,
    revision: skill.revision,
    enabled: true,
    requestId: crypto.randomUUID(),
  });
  const connection = await rpc.mcp.save({
    id: crypto.randomUUID(),
    revision: 0,
    name: "Docs",
    computerId: "pc",
    enabled: false,
    config: { transport: "http", url: "https://example.com/mcp", headers: {} },
  });
  await control({
    nativeSkills: [
      { name: "report", path: "/skills/report/SKILL.md", source: "project" },
      { name: "unresolved", source: "user" },
    ],
    skillsNotice: "原生技能目录读取失败：测试提示",
  });
  const nativeReady = Promise.withResolvers<void>();
  await page.route("**/rpc/mcp/native", async (route) => {
    await nativeReady.promise;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      json: {
        json: { code: "SERVICE_UNAVAILABLE", message: "原生目录暂不可用" },
      },
    });
  });
  await page.goto(url);
  const add = page.getByRole("button", { name: "添加内容", exact: true });
  await add.click();
  await page.getByRole("menuitem", { name: "使用技能…", exact: true }).click();
  const native = page.getByRole("button", { name: "report", exact: true });
  await expect(native).toHaveCount(1);
  await native.hover();
  await expect(page.getByRole("tooltip")).toContainText("pi · project · 只读");
  await expect(
    page.getByRole("button", { name: "unresolved", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("status").filter({ hasText: "原生技能目录读取失败" }),
  ).toBeVisible();
  await native.click();
  await page.reload();
  const input = page.getByLabel("消息", { exact: true });
  await expect(input.locator("[data-inline-token]")).toHaveText(["report"]);
  await input.press("End");
  await input.press("Backspace");
  await add.click();
  await page.getByRole("menuitem", { name: "引用 MCP…", exact: true }).click();
  try {
    await expect(
      page.getByRole("button", { name: "Docs", exact: true }),
    ).toBeVisible();
  } finally {
    nativeReady.resolve();
  }
  await expect(
    page.getByRole("status").filter({ hasText: "服务暂时不可用" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Docs", exact: true }).hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "Domos · 未授权或已停用",
  );
  await page.getByRole("button", { name: "Docs", exact: true }).click();
  await page.reload();
  await expect(input.locator("[data-inline-token]")).toHaveText(["Docs"]);
  await control({ content: "已收到服务引用。" });
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByLabel("Domos 的回复")).toContainText(
    "已收到服务引用。",
  );
  await page.reload();
  await expect(
    page.getByLabel("你的消息").locator(".message-material-token"),
  ).toHaveText(["Docs"]);
  expect(
    (await rpc.mcp.list()).find((item) => item.id === connection.id),
  ).toMatchObject({ enabled: false, grants: [] });
  await page.unroute("**/rpc/mcp/native");
  await page.route("**/rpc/mcp/native", (route) =>
    route.fulfill({
      json: {
        json: {
          provider: "pi",
          computerId: "pc",
          inherited: true,
          inheritance: "native",
          readonly: true,
          status: "complete",
          scope: "configuration",
          errors: [],
          observedAt: 1,
          items: [
            { name: "Docs", source: "project", enabled: true, status: "ready" },
          ],
        },
      },
    }),
  );
  await page.reload();
  await add.click();
  await page.getByRole("menuitem", { name: "引用 MCP…", exact: true }).click();
  const sources = page.getByRole("button", { name: "Docs", exact: true });
  await expect(sources).toHaveCount(2);
  await sources.first().hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "Domos · 未授权或已停用",
  );
  await sources.last().hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "pi · project · 沿用原生配置",
  );
  await page.screenshot({
    path: test.info().outputPath("material-mcp-sources.png"),
  });
  await sources.last().click();
  await page.reload();
  await expect(input.locator("[data-inline-token]")).toHaveText(["Docs"]);
});

test("MCP readers share pending and retained catalogs across the composer and connection center", async ({
  page,
}) => {
  let nativeReads = 0;
  let managedReads = 0;
  const release = Promise.withResolvers<void>();
  await page.route("**/rpc/mcp/list", async (route) => {
    managedReads++;
    await route.continue();
  });
  await page.route("**/rpc/mcp/native", async (route) => {
    nativeReads++;
    await release.promise;
    await route.fulfill({
      json: {
        json: {
          provider: "pi",
          computerId: "pc",
          inherited: true,
          inheritance: "native",
          readonly: true,
          status: "complete",
          scope: "configuration",
          errors: [],
          observedAt: 1,
          items: [
            {
              name: "Shared Docs",
              source: "project",
              enabled: true,
              status: "configured",
            },
          ],
        },
      },
    });
  });
  await page.goto(url);
  const add = page.getByRole("button", { name: "添加内容", exact: true });
  const open = async () => {
    await add.click();
    await page
      .getByRole("menuitem", { name: "引用 MCP…", exact: true })
      .click();
  };
  const close = async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  };
  try {
    await open();
    await expect.poll(() => nativeReads).toBe(1);
    await close();
    await open();
    await expect(
      page.getByRole("status", { name: "正在读取 MCP", exact: true }),
    ).toBeVisible();
    expect(nativeReads).toBe(1);
    release.resolve();
    await expect(
      page.getByRole("button", { name: "Shared Docs", exact: true }),
    ).toBeVisible();
    await close();
    await open();
    await expect(
      page.getByRole("button", { name: "Shared Docs", exact: true }),
    ).toBeVisible();
    expect(nativeReads).toBe(1);
    expect(managedReads).toBe(1);
    await close();
    await page.getByRole("button", { name: "连接中心", exact: true }).click();
    const center = page.getByRole("dialog");
    await center.getByRole("button", { name: "MCP", exact: true }).click();
    await center
      .getByRole("combobox", { name: "选择机器人", exact: true })
      .click();
    await page.getByRole("option", { name: "Domos", exact: true }).click();
    await expect(center.locator(".apps-native-row")).toContainText(
      "Shared Docs",
    );
    expect(nativeReads).toBe(1);
    expect(managedReads).toBe(1);
    await center.getByRole("button", { name: "刷新连接", exact: true }).click();
    await expect(
      center.getByRole("button", { name: "刷新连接", exact: true }),
    ).toBeEnabled();
    expect(nativeReads).toBe(2);
    expect(managedReads).toBe(2);
  } finally {
    release.resolve();
  }
});

test("native MCP reads keep partial, failed, unsupported and complete empty states distinct", async ({
  page,
}) => {
  let state = "partial";
  await page.route("**/rpc/mcp/native", (route) =>
    route.fulfill({
      json: {
        json: {
          provider: "opencode",
          computerId: "pc",
          inherited: true,
          inheritance: "native",
          readonly: true,
          scope: "session",
          sessionId: "private",
          observedAt: 1,
          status: state,
          errors:
            state === "partial" || state === "failed"
              ? [{ message: "Project catalog unavailable", code: 503 }]
              : [],
          items:
            state === "partial"
              ? [
                  {
                    name: "plugin:docs:search",
                    source: "project",
                    enabled: null,
                    status: "unknown",
                  },
                ]
              : [],
        },
      },
    }),
  );
  await page.goto(url);
  await page.getByRole("button", { name: "添加内容", exact: true }).click();
  await page.getByRole("menuitem", { name: "引用 MCP…", exact: true }).click();
  await expect(page.getByText("当前私聊会话", { exact: true })).toBeVisible();
  const service = page.getByRole("button", {
    name: "plugin:docs:search",
    exact: true,
  });
  await expect(service).toBeVisible();
  await service.hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "启用状态未知 · 连接状态未知",
  );
  await expect(page.getByRole("tooltip")).toContainText("沿用原生配置");
  const refresh = page.getByRole("button", {
    name: "刷新原生连接",
    exact: true,
  });
  for (const [next, label] of [
    ["failed", "原生目录读取失败"],
    ["unsupported", "此 Harness 尚未提供目录接口"],
    ["complete", "暂无 MCP 连接"],
  ] as const) {
    state = next;
    await refresh.click();
    await expect(service).toHaveCount(0);
    await expect(
      page.getByText(label, { exact: next === "complete" }),
    ).toBeVisible();
    if (next !== "complete")
      await expect(
        page.getByText("暂无 MCP 连接", { exact: true }),
      ).toHaveCount(0);
  }
  await page.screenshot({
    path: test.info().outputPath("native-mcp-empty.png"),
  });
});

test("Bot readers retain model and skill data while live skill changes reach the composer", async ({
  page,
}) => {
  const rpc: RouterClient<AppRouter> = createORPCClient(
    new RPCLink({ url: `${url}/rpc` }),
  );
  const bot = (await rpc.bots.list())[0];
  if (!bot) throw new Error("Bot required");
  const skill = await rpc.work.skills.save({
    botId: bot.id,
    id: crypto.randomUUID(),
    revision: 0,
    requestId: crypto.randomUUID(),
    content:
      "---\nname: shared-report\ndescription: Report\n---\nRead source files",
  });
  await rpc.work.skills.enable({
    botId: bot.id,
    id: skill.id,
    revision: skill.revision,
    enabled: true,
    requestId: crypto.randomUUID(),
  });
  const enabledSkill = (await rpc.work.get({ botId: bot.id })).skills.find(
    (item) => item.id === skill.id,
  );
  if (!enabledSkill) throw new Error("Skill required");
  const reads = { work: 0, model: 0, inspect: 0 };
  page.on("request", (request) => {
    if (request.url().endsWith("/rpc/work/get")) reads.work++;
    if (request.url().endsWith("/rpc/engines/get")) reads.model++;
    if (request.url().endsWith("/rpc/engines/inspect")) reads.inspect++;
  });
  await page.goto(url);
  const details = await openDetails(page);
  const model = details.getByRole("combobox", { name: "模型", exact: true });
  await expect(model).toContainText("测试模型一");
  await model.click();
  await expect(
    page.getByRole("option", { name: "Pi · 测试模型二", exact: true }),
  ).toBeVisible();
  const initial = { ...reads };
  await page.keyboard.press("Escape");
  await details
    .getByRole("button", { name: "模型与账号", exact: true })
    .click();
  await expect(
    details.getByRole("combobox", { name: "模型", exact: true }),
  ).toBeVisible();
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await details.getByRole("button", { name: "关闭", exact: true }).click();
  const add = page.getByRole("button", { name: "添加内容", exact: true });
  const open = async () => {
    await add.click();
    await page
      .getByRole("menuitem", { name: "使用技能…", exact: true })
      .click();
  };
  await open();
  const choice = page.getByRole("button", {
    name: "shared-report",
    exact: true,
  });
  await expect(choice).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await open();
  await expect(choice).toBeVisible();
  expect(reads).toEqual(initial);
  expect(reads.model).toBe(1);
  expect(reads.work).toBe(1);
  await rpc.work.skills.enable({
    botId: bot.id,
    id: skill.id,
    revision: enabledSkill.revision,
    enabled: false,
    requestId: crypto.randomUUID(),
  });
  await expect(choice).toHaveCount(0);
  expect(reads.work).toBe(1);
});

test("file lists retain pages across opens and update when new attachments arrive", async ({
  page,
}) => {
  const rpc: RouterClient<AppRouter> = createORPCClient(
    new RPCLink({ url: `${url}/rpc` }),
  );
  const bot = (await rpc.bots.list())[0];
  if (!bot) throw new Error("Bot required");
  let reads = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/rpc/files/list")) reads++;
  });
  await page.goto(url);
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
  await control({ content: "已收到。" });
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
