import { type ChildProcess, fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

let worker: ChildProcess;
let directory: string;
let url: string;
let toolName: string;
const it = test.extend({ trace: "off" });

test("detail pages load their own data and isolate profile errors", async ({
  page,
}) => {
  let streams = 0;
  let profiles = 0;
  await page.route("**/rpc/work/subscribe", async (route) => {
    streams++;
    await route.abort();
  });
  await page.route("**/rpc/work/profile", async (route) => {
    profiles++;
    await route.continue();
  });
  await page.goto(url);
  const details = page.locator("#bot-details");
  await details.getByRole("tab", { name: "Computer", exact: true }).click();
  await page.getByRole("button", { name: "电脑设置", exact: true }).click();
  await expect(
    details.getByRole("region", { name: "工作电脑", exact: true }),
  ).toBeVisible();
  await expect(details.getByRole("status")).toHaveCount(0);
  expect(streams).toBe(0);
  expect(profiles).toBe(0);
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await details.getByRole("tab", { name: "Bot", exact: true }).click();
  await details.getByRole("button", { name: "编辑", exact: true }).click();
  const name = details.getByRole("textbox", { name: "名字", exact: true });
  await expect(name).toHaveValue("Domos");
  await name.fill("保留资料草稿");
  expect(profiles).toBe(1);
  await expect(details.getByRole("status")).toHaveCount(0);
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await details.getByRole("button", { name: /^技能/ }).click();
  await expect(details.getByRole("alert")).toContainText("详情连接中断");
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await details.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(name).toHaveValue("保留资料草稿");
  await expect(details.getByRole("alert")).toHaveCount(0);
});

test("profile loading recovers without retaining an old error", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/rpc/work/profile", async (route) => {
    if (fail) await route.fulfill({ status: 503, body: "Unavailable" });
    else await route.continue();
  });
  await page.goto(url);
  const details = page.locator("#bot-details");
  await details.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(details.getByRole("alert")).toContainText("资料加载失败");
  await expect(details.getByRole("status")).toHaveCount(0);
  fail = false;
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await details.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(
    details.getByRole("textbox", { name: "名字", exact: true }),
  ).toHaveValue("Domos");
  await expect(details.getByRole("alert")).toHaveCount(0);
});

test("three columns keep the identity capsule and navigation clear at each width", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1600, height: 960 });
  let workStreams = 0;
  await page.route("**/rpc/work/subscribe", async (route) => {
    workStreams++;
    await route.continue();
  });
  await page.goto(url);
  const details = page.locator("#bot-details");
  const capsule = page.getByRole("button", { name: "Bot详情", exact: true });
  await expect(details).toBeVisible();
  await expect(details.getByRole("button", { name: /^记忆/ })).toBeVisible();
  expect(workStreams).toBe(0);
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
  expect(logo.x).toBeLessThan(avatar.x + avatar.width);
  await expect(mark).toHaveAttribute("data-provider", "pi");
  await expect(capsule.locator(".character")).toHaveCount(1);
  const footer = page.locator(".sidebar-footer");
  const composer = await page.locator(".message-composer").boundingBox();
  if (!composer) throw new Error("Composer missing");
  expect(composer.y + composer.height).toBeGreaterThan(930);
  await expect(
    footer.getByRole("button", { name: "用量", exact: true }),
  ).toBeVisible();
  await expect(
    footer.getByRole("button", { name: "设置", exact: true }),
  ).toBeVisible();
  await page.getByLabel("消息", { exact: true }).fill("保留这份草稿");
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(capsule).toHaveCSS(
      "background-color",
      theme === "dark" ? "rgb(20, 20, 22)" : "rgb(250, 250, 250)",
    );
    await expect(capsule).toHaveCSS("border-width", "1px");
    await expect(capsule).not.toHaveCSS("box-shadow", "none");
    await page.screenshot({ path: info.outputPath(`workspace-${theme}.png`) });
  }
  await details.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(details).toBeHidden();
  await capsule.click();
  await expect(details).toBeVisible();
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole("dialog", { name: "Bot详情", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath(`workspace-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("消息", { exact: true })).toHaveValue(
      "保留这份草稿",
    );
    if (width === 768) await capsule.click();
  }
  await page.getByRole("button", { name: "联系人", exact: true }).click();
  await expect(
    footer.getByRole("button", { name: "设置", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Domos", exact: true }).click();
  await expect(page.getByLabel("消息", { exact: true })).toBeVisible();
});

test("centered dialogs share stable geometry and Harness marks", async ({
  page,
}) => {
  await page.goto(url);
  for (const selector of [".chat-identity", ".context-ring"]) {
    const mark = page.locator(`${selector} .engine-mark`);
    await expect(mark).toHaveAttribute("data-provider", "pi");
    await expect(mark.locator("path")).not.toHaveCount(0);
    await expect(mark).toHaveCSS("transform", "none");
  }
  for (const width of [1360, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 390) {
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "联系人", exact: true }).click();
    }
    await page.getByRole("button", { name: "设置", exact: true }).click();
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
      "blur(8px)",
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
      "blur(8px)",
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
    }
    await page.keyboard.press("Escape");
    if (width === 390) await page.keyboard.press("Escape");
  }
});

test("chat input stays active while a panel closes", async ({ page }) => {
  await page.goto(url);
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

test("sending paints the outgoing message before the network receipt", async ({
  page,
}) => {
  await page.goto(url);
  const seeded = once(worker, "message");
  worker.send({ history: 160 });
  await seeded;
  await page.reload();
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(input).toBeEnabled();
  await page.locator(".transcript").evaluate((node) => {
    node.scrollTop = 0;
  });
  const receipt = Promise.withResolvers<void>();
  await page.route("**/rpc/send", async (route) => {
    await receipt.promise;
    await route.continue();
  });
  await input.fill("即时发送检查");
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.evaluate(() => {
    document.addEventListener("keydown", () => performance.mark("send-start"), {
      once: true,
    });
    const observer = new MutationObserver(() => {
      const messages = document.querySelectorAll('[aria-label="你的消息"]');
      if (
        messages[messages.length - 1]?.textContent?.includes("即时发送检查")
      ) {
        requestAnimationFrame(() => {
          performance.mark("send-painted");
          performance.measure("send-paint", "send-start", "send-painted");
        });
        observer.disconnect();
      }
    });
    observer.observe(document.querySelector(".messages")!, {
      subtree: true,
      childList: true,
    });
  });
  try {
    await input.press("Enter");
    await expect(page.getByLabel("你的消息").last()).toContainText(
      "即时发送检查",
    );
    await expect
      .poll(() =>
        page.evaluate(() => performance.getEntriesByName("send-paint").length),
      )
      .toBe(1);
    const duration = await page.evaluate(
      () => performance.getEntriesByName("send-paint")[0]!.duration,
    );
    console.log(
      `send paint with 320 history messages and 4x CPU: ${duration.toFixed(1)}ms`,
    );
    expect(duration).toBeLessThan(200);
    await expect(page.locator(".typing-dots")).toHaveCount(0);
    await expect
      .poll(() =>
        page
          .locator(".transcript")
          .evaluate(
            (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
          ),
      )
      .toBeLessThanOrEqual(1);
  } finally {
    receipt.resolve();
    await session.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }
});

test("chat reads older pages and retains them through live updates", async ({
  page,
}) => {
  const receipt = once(worker, "message");
  worker.send({ history: 160 });
  await receipt;
  await page.goto(url);
  await expect(page.getByLabel("你的消息").last()).toContainText(
    "历史任务 160",
  );
  const earlier = page.getByRole("button", {
    name: "查看更早的消息",
    exact: true,
  });
  await earlier.click();
  const response = page.waitForResponse((response) =>
    response.url().endsWith("/rpc/get"),
  );
  await earlier.click();
  const pageData = (await (await response).json()).json;
  expect(pageData.messages.length).toBeLessThanOrEqual(200);
  await expect(page.getByLabel("你的消息").first()).toHaveText("历史任务 1");
  await expect(earlier).toBeHidden();
  const scripted = once(worker, "message");
  worker.send({ content: "翻页后已完成" });
  await scripted;
  await page.getByLabel("消息", { exact: true }).fill("翻页后发送");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByLabel("Domos 的回复").last()).toContainText(
    "翻页后已完成",
  );
  while (await earlier.isVisible()) await earlier.click();
  await expect(page.getByLabel("你的消息").first()).toHaveText("历史任务 1");
});

test("usage reports native task costs and preserves session snapshots across themes", async ({
  page,
}, info) => {
  const records = Array.from({ length: 8 }, (_, index) => ({
    id: `usage-${index}`,
    taskId: `task-${index}`,
    botId: 1,
    sessionId: "session",
    harness: index < 2 ? "claude" : "pi",
    provider: `provider-${index}`,
    model: `model-${index}`,
    source: "native-test",
    timestamp: Date.now(),
    input: index === 7 ? null : 1000 * (index + 1),
    output: 100,
    cacheRead: null,
    cacheWrite: null,
    costUsd: index < 2 ? 100 + index : index === 7 ? null : 0.5,
    ...(index < 2 ? { costScope: "session" } : {}),
  }));
  let mode = "loading";
  const loaded = Promise.withResolvers<void>();
  await page.route("**/rpc/engines/usage", async (route) => {
    await loaded.promise;
    if (mode === "error") await route.abort();
    else
      await route.fulfill({ json: { json: mode === "empty" ? [] : records } });
  });
  await page.goto(url);
  await page.getByRole("button", { name: "用量", exact: true }).click();
  const usage = page.getByRole("main", { name: "用量", exact: true });
  await expect(usage.getByLabel("正在读取用量")).toBeVisible();
  mode = "data";
  loaded.resolve();
  await expect(usage.locator(".usage-hero-value")).toContainText("$2.50");
  await expect(usage.locator(".usage-footer")).toContainText("2 条会话累计");
  await expect(usage.locator(".usage-footer")).toContainText("1 条成本未提供");
  const summary = usage.getByRole("list", { name: "分组用量", exact: true });
  const details = usage.getByRole("table", { name: "用量明细", exact: true });
  const scroll = page.locator(".usage-surface > .scroll-viewport");
  await expect(scroll).toHaveCSS("scrollbar-width", "none");
  await expect(page.locator(".usage-surface > .scroll-bar")).toHaveCount(1);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const search = usage.getByRole("searchbox", { name: "搜索用量记录" });
    await search.click();
    await expect(search).toHaveCSS("outline-style", "none");
    await expect(summary).toContainText("model-2");
    await expect(summary).toContainText("其他");
    await expect(details).toContainText("$101.00");
    await expect(details).toContainText("会话累计");
    await page.screenshot({
      path: info.outputPath(`usage-overview-${colorScheme}.png`),
    });
    await usage.getByRole("button", { name: "输入用量", exact: true }).click();
    await expect(
      usage.getByRole("heading", { name: "输入用量趋势", exact: true }),
    ).toBeVisible();
    await expect(usage.locator(".usage-hero-value")).toContainText("$2.50");
    await usage.getByRole("button", { name: "Provider", exact: true }).click();
    await expect(summary).toContainText("provider-2");
    await page.screenshot({
      path: info.outputPath(`usage-explore-${colorScheme}.png`),
    });
    await usage.getByRole("button", { name: "任务成本", exact: true }).click();
    await usage.getByRole("button", { name: "模型", exact: true }).click();
    await scroll.evaluate((node) => {
      node.scrollTo({ top: node.scrollHeight });
    });
    await expect(details).toBeInViewport();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`usage-mobile-${colorScheme}.png`),
    });
    await page.setViewportSize({ width: 1360, height: 900 });
    await scroll.evaluate((node) => {
      node.scrollTo({ top: 0 });
    });
  }
  mode = "empty";
  await usage.getByRole("button", { name: "刷新用量", exact: true }).click();
  await expect(
    usage.getByText("此范围还没有用量记录。", { exact: true }),
  ).toBeVisible();
  mode = "error";
  await usage.getByRole("button", { name: "刷新用量", exact: true }).click();
  await expect(usage.getByRole("alert")).toBeVisible();
  mode = "data";
  await usage.getByRole("button", { name: "重试", exact: true }).click();
  await expect(usage.locator(".usage-hero-value")).toContainText("$2.50");
});

test("usage totals distinguish unknown costs and include recorded zero-cost days", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-03T12:00:00Z"));
  const record = {
    id: "usage-1",
    taskId: "task-1",
    botId: 1,
    sessionId: "session",
    harness: "pi",
    provider: "provider",
    model: "model",
    source: "native-test",
    timestamp: Date.parse("2026-10-01T12:00:00Z"),
    input: 10,
    output: 1,
    cacheRead: null,
    cacheWrite: null,
    costUsd: null as number | null,
  };
  let records: (typeof record & { costScope?: "session" })[] = [record];
  await page.route("**/rpc/engines/usage", (route) =>
    route.fulfill({ json: { json: records } }),
  );
  await page.goto(url);
  await page.getByRole("button", { name: "用量", exact: true }).click();
  const usage = page.getByRole("main", { name: "用量", exact: true });
  const total = usage.locator(".usage-breakdown-total");
  await expect(usage.locator(".usage-hero-value")).toHaveText("未提供");
  await expect(total).toContainText("未提供");
  records = [{ ...record, costUsd: 100, costScope: "session" }];
  await usage.getByRole("button", { name: "刷新用量", exact: true }).click();
  await expect(usage.locator(".usage-footer")).toContainText("1 条会话累计");
  await expect(usage.locator(".usage-hero-value")).toHaveText("未提供");
  await expect(total).toContainText("未提供");
  records = [
    { ...record, costUsd: 1 },
    {
      ...record,
      id: "usage-2",
      taskId: "task-2",
      timestamp: Date.parse("2026-10-02T12:00:00Z"),
      costUsd: 0,
    },
  ];
  await usage.getByRole("button", { name: "刷新用量", exact: true }).click();
  await expect(usage.locator(".usage-facts")).toContainText(
    "日均（有记录 2 天）$0.50",
  );
  records = [{ ...record, costUsd: 0 }];
  await usage.getByRole("button", { name: "刷新用量", exact: true }).click();
  await expect(usage.locator(".usage-facts")).toContainText(
    "峰值日10月1日$0.00",
  );
  await expect(usage.locator(".usage-facts")).toContainText(
    "日均（有记录 1 天）$0.00",
  );
});

test("long bubbles fold with a fade and retain full text without outgoing timestamps", async ({
  page,
}) => {
  const receipt = once(worker, "message");
  worker.send({ content: "核对结果。\n\n".repeat(28) });
  await receipt;
  await page.goto(url);
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
  const gap = await incoming.evaluate(
    (node) =>
      node.getBoundingClientRect().top -
      (node.previousElementSibling?.getBoundingClientRect().bottom ?? 0),
  );
  expect(gap).toBeGreaterThanOrEqual(12);
  await page.reload();
  await expect(page.getByLabel("你的消息")).toHaveCount(1);
  await expect(
    page
      .getByLabel("Domos 的回复")
      .getByRole("button", { name: "展开", exact: true }),
  ).toBeVisible();
});

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
  const [ready] = (await once(worker, "message")) as [
    { port: number; toolName: string },
  ];
  url = `http://127.0.0.1:${ready.port}`;
  toolName = ready.toolName;
});

test.afterEach(async () => {
  const exited = once(worker, "exit");
  worker.disconnect();
  await exited;
  await rm(directory, { recursive: true, force: true, maxRetries: 5 });
});

test("remote Docker setup submits the selected browser network policy", async ({
  page,
}, testInfo) => {
  await page.goto(url);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("main", { name: "设置", exact: true });
  await settings
    .getByRole("group", { name: "电脑高级管理", exact: true })
    .getByRole("button", { name: "打开", exact: true })
    .click();
  await settings
    .getByRole("button", { name: "添加 Docker 电脑", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "添加 Docker 电脑",
    exact: true,
  });
  await dialog.getByRole("combobox", { name: "Docker 位置" }).click();
  await page.getByRole("option", { name: "远程 Docker", exact: true }).click();
  await dialog
    .getByLabel("SSH 主机", { exact: true })
    .fill("work.example.test");
  await dialog
    .getByLabel("主机密钥文件路径", { exact: true })
    .fill("/home/user/.ssh/known_hosts");
  await expect(
    dialog.getByRole("combobox", { name: "网络策略" }),
  ).toContainText("关闭外部网络");
  await dialog.getByRole("combobox", { name: "网络策略" }).click();
  await page
    .getByRole("option", { name: "允许 HTTP(S) 网站", exact: true })
    .click();
  await dialog.getByLabel("代理镜像", { exact: true }).fill("domos-egress:1");
  await page.screenshot({
    path: testInfo.outputPath("remote-browser-network.png"),
  });
  const submitted = Promise.withResolvers<unknown>();
  await page.route("**/rpc/computer/add", async (route) => {
    submitted.resolve(route.request().postDataJSON());
    await route.abort();
  });
  await dialog.getByRole("button", { name: "添加电脑", exact: true }).click();
  expect(JSON.stringify(await submitted.promise)).toContain('"network":"web"');
  expect(JSON.stringify(await submitted.promise)).toContain(
    '"proxyImage":"domos-egress:1"',
  );
  expect(JSON.stringify(await submitted.promise)).toContain(
    '"host":"work.example.test"',
  );
  await expect(dialog.getByRole("alert")).toBeVisible();
});

test("Bot model selection saves choices and fits both themes", async ({
  page,
}, info) => {
  await page.goto(url);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const trigger = page.getByRole("combobox", {
    name: "模型",
    exact: true,
  });
  await trigger.click();
  const selector = page.locator(".model-selector-popup");
  const search = selector.getByRole("searchbox", {
    name: "搜索模型…",
    exact: true,
  });
  await expect(selector.getByRole("alert")).toHaveCount(0);
  await search.fill("模型二");
  const choice = selector.getByRole("option", { name: /测试模型二/ });
  await expect(choice).toBeVisible();
  await expect(
    selector.getByRole("option", { name: /测试模型一/ }),
  ).toHaveCount(0);
  await page.route("**/rpc/engines/configure", (route) => route.abort(), {
    times: 1,
  });
  await choice.click();
  await expect(selector).toBeHidden();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /fetch|network|请求|Failed/i })
      .first(),
  ).toBeVisible();
  await expect(trigger).toContainText("测试模型一");
  await trigger.click();
  await choice.click();
  await expect(selector).toBeHidden();
  await expect(trigger).toContainText("测试模型二");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const response = await fetch("/rpc/engines/get", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: { botId: 1 } }),
        });
        return (await response.json()).json.config.model;
      }),
    )
    .toBe("faux/faux-2");
  await page.reload();
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await expect(trigger).toContainText("测试模型二");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [1360, 390]) {
      await page.setViewportSize({ width, height: 600 });
      await trigger.click();
      await expect(choice).toHaveAttribute("aria-selected", "true");
      const box = await selector.boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(600);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`selector-${colorScheme}-${width}.png`),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
    }
  }
});

test("native Harness controls persist and client accounts retain model access", async ({
  page,
  browser,
}, info) => {
  const exited = once(worker, "exit");
  worker.disconnect();
  await exited;
  worker = fork(
    fileURLToPath(
      new URL("../../api/test/fixtures/web-server.ts", import.meta.url),
    ),
    [join(directory, "data.sqlite"), "0", "hosting"],
    { silent: true, execArgv: [] },
  );
  worker.stderr?.resume();
  worker.stdout?.resume();
  const [ready] = (await once(worker, "message")) as [
    { port: number; pairing: string },
  ];
  url = `http://127.0.0.1:${ready.port}`;
  await page.goto(url);
  await page.getByLabel("配对码", { exact: true }).fill(ready.pairing);
  await page.getByRole("button", { name: "连接", exact: true }).click();
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const trigger = page.getByRole("combobox", { name: "模型", exact: true });
  const popup = page.locator(".model-selector-popup");
  const captions = await page
    .locator(".engine-choices > .setting-row .setting-caption")
    .evaluateAll((nodes) =>
      nodes.map((node) => Math.round(node.getBoundingClientRect().x)),
    );
  expect(captions.length).toBe(3);
  expect(new Set(captions).size).toBe(1);
  await trigger.click();
  await expect(popup.getByRole("tab")).toHaveCount(5);
  const choice = popup.getByRole("option", {
    name: "Pi · 测试模型二",
    exact: true,
  });
  await expect(choice).toBeVisible();
  expect(
    await popup
      .locator(".model-selector-rail")
      .evaluate((node) => node.scrollWidth === node.clientWidth),
  ).toBe(true);
  await page.keyboard.press("Escape");
  const resumed = Promise.withResolvers<void>();
  await page.route("**/rpc/engines/inspect", async (route) => {
    await resumed.promise;
    await route.continue();
  });
  try {
    for (let index = 0; index < 2; index++) {
      await trigger.click();
      await expect(choice).toBeVisible({ timeout: 500 });
      await expect(popup).not.toContainText("还未安装");
      await expect(popup).not.toContainText("加载中");
      await page.keyboard.press("Escape");
    }
    await trigger.click();
    await popup.getByRole("tab", { name: "Codex", exact: true }).click();
    await popup.getByRole("tab", { name: "Pi", exact: true }).click();
    await expect(choice).toBeVisible({ timeout: 500 });
  } finally {
    resumed.resolve();
    await page.unrouteAll({ behavior: "wait" });
  }
  const saveGate = Promise.withResolvers<void>();
  let saves = 0;
  let sends = 0;
  await page.route("**/rpc/send", async (route) => {
    sends++;
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        json: { code: "CONFLICT", message: "测试发送结束", status: 409 },
      }),
    });
  });
  await page.route("**/rpc/engines/configure", async (route) => {
    saves++;
    await saveGate.promise;
    await route.continue();
  });
  const effort = popup.getByRole("radiogroup", { name: "推理强度" });
  try {
    await choice.click();
    await expect(trigger).toContainText("测试模型二", { timeout: 200 });
    await expect(popup).toBeHidden();
    await trigger.click();
    await expect(
      effort.getByRole("radio", { name: "高", exact: true }),
    ).toBeEnabled();
    await effort.getByRole("radio", { name: "高", exact: true }).click();
    await expect(
      effort.getByRole("radio", { name: "高", exact: true }),
    ).toBeChecked();
    expect(saves).toBe(1);
    await page.keyboard.press("Escape");
    await page.getByLabel("消息", { exact: true }).fill("等待配置保存后发送");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByLabel("你的消息").last()).toContainText(
      "等待配置保存后发送",
    );
    expect(sends).toBe(0);
  } finally {
    saveGate.resolve();
    await page.unroute("**/rpc/engines/configure");
  }
  await expect.poll(() => sends).toBe(1);
  await page.unroute("**/rpc/send");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const response = await fetch("/rpc/engines/get", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: { botId: 1 } }),
        });
        return (await response.json()).json.config.options?.thinkingLevel;
      }),
    )
    .toBe("high");
  await page.reload();
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await trigger.click();
  await expect(
    effort.getByRole("radio", { name: "高", exact: true }),
  ).toBeChecked();
  await popup.getByRole("tab", { name: "自定义 ACP", exact: true }).click();
  await expect(popup.getByLabel("程序路径", { exact: true })).toBeVisible();
  await popup.getByLabel("程序路径", { exact: true }).fill("example-acp");
  await popup.getByLabel("启动参数", { exact: true }).fill("invalid");
  await popup.getByRole("button", { name: "检查连接", exact: true }).click();
  await expect(popup.getByRole("alert")).toContainText("JSON");
  await expect(trigger).toContainText("测试模型二");
  for (const width of [1360, 390]) {
    await page.setViewportSize({ width, height: 600 });
    await page.screenshot({
      path: info.outputPath(`native-connection-${width}.png`),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  const response = await page.request.post(`${url}/hosting/pairing`, {
    data: { scope: "client" },
    headers: { Origin: url },
  });
  const pairing = await response.json();
  const client = await browser.newContext();
  try {
    const paired = await client.newPage();
    await paired.goto(url);
    await paired.getByLabel("配对码", { exact: true }).fill(pairing.code);
    await paired.getByRole("button", { name: "连接", exact: true }).click();
    await paired.getByRole("button", { name: "Bot详情", exact: true }).click();
    await paired.getByRole("combobox", { name: "模型", exact: true }).click();
    await expect(
      paired.getByRole("tab", { name: "Pi", exact: true }),
    ).toBeVisible();
    await expect(
      paired.getByRole("button", { name: "配置连接", exact: true }),
    ).toHaveCount(0);
    await paired
      .getByRole("option", { name: "Pi · 测试模型一", exact: true })
      .click();
    await expect(
      paired.getByRole("combobox", { name: "模型", exact: true }),
    ).toContainText("测试模型一");
    expect((await paired.request.get(`${url}/hosting/models`)).status()).toBe(
      403,
    );
    expect(
      (
        await paired.request.post(`${url}/rpc/engines/install`, {
          data: { json: { botId: 1, config: { provider: "pi", model: null } } },
        })
      ).status(),
    ).toBe(403);
  } finally {
    await client.close();
  }
});

test("computer viewing uses separate tabs and releases control when closed", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(url);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await page.getByRole("tab", { name: "Computer", exact: true }).click();
  const details = page.locator("#bot-details");
  const identity = details.locator(".detail-identity");
  await expect(identity).toBeInViewport({ ratio: 1 });
  const first = await identity.boundingBox();
  await expect(details.locator(".bot-hero")).toHaveCount(1);
  await details.getByRole("button", { name: "电脑设置", exact: true }).click();
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await expect(
    details.getByRole("tab", { name: "Computer", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await details.getByRole("tab", { name: "Browser", exact: true }).click();
  expect(await identity.boundingBox()).toEqual(first);
  const view = page.getByRole("region", { name: "Domos的电脑", exact: true });
  await view.getByRole("button", { name: "启用浏览器", exact: true }).click();
  const screen = view.getByRole("img", { name: "工作电脑画面" });
  await expect(screen).toBeVisible({ timeout: 30000 });
  await expect(
    view.getByRole("textbox", { name: "网址", exact: true }),
  ).toHaveCount(0);
  await expect(view.getByRole("tab")).toHaveCount(0);
  await view.getByRole("button", { name: "接管", exact: true }).click();
  await expect(view.getByRole("status")).toHaveText("你正在操作");
  expect((await view.boundingBox())?.width).toBeLessThan(700);
  await view.getByRole("button", { name: "展开工作区", exact: true }).click();
  await expect
    .poll(async () => (await view.boundingBox())?.width)
    .toBeGreaterThan(800);
  await view.getByRole("button", { name: "收起工作区", exact: true }).click();
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(screen).toBeInViewport({ ratio: 1 });
      await expect(
        view.getByRole("button", { name: "全屏", exact: true }),
      ).toBeInViewport();
      await page.screenshot({
        path: info.outputPath(`computer-${theme}-${width}.png`),
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
    }
  }
  await view.getByRole("button", { name: "交还", exact: true }).click();
  await details.getByRole("tab", { name: "Computer", exact: true }).click();
  await expect(
    view.getByRole("button", { name: "启用桌面", exact: true }),
  ).toBeVisible();
  expect((await identity.boundingBox())?.height).toBe(first?.height);
  await details.getByRole("tab", { name: "Bot", exact: true }).click();
  await expect(
    details.getByRole("combobox", { name: "模型", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1360, height: 900 });
  await details.getByRole("tab", { name: "Browser", exact: true }).click();
  await expect(
    view.getByRole("button", { name: "接管", exact: true }),
  ).toBeVisible();
  await details.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Bot详情", exact: true }),
  ).toBeFocused();
});

test("workspace empty states stay centered at every panel width", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const state of ["loading", "disabled", "unavailable", "failed"]) {
    await page.route("**/rpc/computer/services", async (route) => {
      if (state === "loading") return;
      if (state === "failed") return route.abort();
      const value = { enabled: state === "unavailable", available: false };
      await route.fulfill({
        json: { json: { browser: value, desktop: value } },
      });
    });
    await page.goto(url);
    await page.getByRole("button", { name: "Bot详情", exact: true }).click();
    await page.getByRole("tab", { name: "Computer", exact: true }).click();
    if (state === "loading")
      await expect(
        page.getByRole("heading", { name: "正在连接工作电脑…" }),
      ).toBeVisible();
    else if (state === "failed")
      await expect(
        page.getByRole("heading", { name: "电脑暂时无法连接" }),
      ).toBeVisible();
    else if (state === "unavailable")
      await expect(
        page.getByRole("heading", { name: "桌面尚未就绪" }),
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

test("computer connection failures keep a direct retry", async ({ page }) => {
  await page.route("**/rpc/computer/services", (route) =>
    route.abort("failed"),
  );
  await page.goto(url);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await page.getByRole("tab", { name: "Computer", exact: true }).click();
  const view = page.getByRole("region", {
    name: "Domos的电脑",
    exact: true,
  });
  await expect(view.getByRole("alert")).toBeVisible();
  await expect(
    view.getByRole("heading", { name: "电脑暂时无法连接" }),
  ).toBeVisible();
  await page.unroute("**/rpc/computer/services");
  await view.getByRole("button", { name: "重新连接", exact: true }).click();
  await expect(
    view.getByRole("button", { name: "启用桌面", exact: true }),
  ).toBeVisible();
  await expect(view.getByRole("alert")).toHaveCount(0);
});

it("chat reflows within the frame budget and retains its position", async ({
  page,
}) => {
  test.setTimeout(60000);
  let receipt = once(worker, "message");
  worker.send({ history: 160 });
  await receipt;
  await page.setViewportSize({ width: 1600, height: 960 });
  await page.goto(url);
  receipt = once(worker, "message");
  worker.send({
    content:
      "这是一段用来检查拖拽时阅读位置的长消息，需要在容器改变宽度时保持最新消息的底边稳定。".repeat(
        4,
      ) +
      "\n\n| 职位 | 地点 | 薪酬 |\n| --- | --- | --- |\n| 工程师 | Remote | $100,000 |",
  });
  await receipt;
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill("检查布局");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".message table").last()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator(".transcript")
        .evaluate(
          (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
        ),
    )
    .toBeLessThanOrEqual(1);
  const frames = await page.evaluateHandle(() => {
    const viewport = document.querySelector<HTMLElement>(".transcript");
    if (!viewport) throw new Error("Transcript missing");
    const times: number[] = [];
    let frame = 0;
    const sample = (time: number) => {
      times.push(time);
      frame = requestAnimationFrame(sample);
    };
    return {
      start() {
        times.length = 0;
        frame = requestAnimationFrame(sample);
      },
      finish(slowFrame = 25) {
        cancelAnimationFrame(frame);
        let previous = times[0] ?? 0;
        const gaps = times.slice(1).map((time) => {
          const gap = time - previous;
          previous = time;
          return gap;
        });
        gaps.sort((a, b) => a - b);
        return {
          gap:
            viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop,
          count: gaps.length,
          p95: gaps[Math.floor(gaps.length * 0.95)],
          slow: gaps.filter((time) => time > slowFrame).length / gaps.length,
        };
      },
    };
  });
  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable", { timeDomain: "threadTicks" });
  const metrics = async () => {
    const { metrics } = await session.send("Performance.getMetrics");
    const read = (name: string) => {
      const value = metrics.find((metric) => metric.name === name)?.value;
      if (value === undefined)
        throw new Error(`Missing performance metric: ${name}`);
      return value;
    };
    return {
      layouts: read("LayoutCount"),
      layoutMs: (read("LayoutDuration") + read("RecalcStyleDuration")) * 1000,
    };
  };
  await session.send("Emulation.setCPUThrottlingRate", { rate: 2 });
  await frames.evaluate((recording) => recording.start());
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let count = 0;
        const sample = () => {
          if (++count === 30) resolve();
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
  );
  const baseline = await frames.evaluate((recording) => recording.finish());
  console.log(`Idle frame timing: ${JSON.stringify(baseline)}`);
  if (baseline.p95 === undefined) throw new Error("Idle frame timing missing");
  const slowFrame = Math.max(25, baseline.p95 * 1.5);
  for (const side of ["联系人", "详情"]) {
    const handle = page.getByRole("separator", { name: `调整${side}宽度` });
    const box = await handle.boundingBox();
    const messages = page.locator(".messages");
    const input = page.getByRole("textbox", { name: "消息", exact: true });
    const body = await messages.boundingBox();
    const composer = await input.boundingBox();
    if (!box || !body || !composer) throw new Error("Chat layout missing");
    await page.mouse.move(box.x + box.width / 2, box.y + 100);
    await page.mouse.down();
    await expect(page.locator(".workspace-content")).toHaveAttribute(
      "data-resizing",
      "true",
    );
    const before = await metrics();
    await frames.evaluate((recording) => recording.start());
    await page.mouse.move(
      box.x + (side === "联系人" ? 60 : -240),
      box.y + 100,
      { steps: 50 },
    );
    expect((await messages.boundingBox())?.width).not.toBe(body.width);
    expect((await input.boundingBox())?.width).not.toBe(composer.width);
    await page.mouse.move(box.x + (side === "联系人" ? -40 : 60), box.y + 100, {
      steps: 50,
    });
    expect((await messages.boundingBox())?.width).not.toBe(body.width);
    expect(
      await page.evaluate(() => Boolean(document.activeViewTransition)),
    ).toBe(false);
    const measured = await frames.evaluate(
      (recording, threshold) => recording.finish(threshold),
      slowFrame,
    );
    const after = await metrics();
    const layouts = after.layouts - before.layouts;
    const layoutMs = after.layoutMs - before.layoutMs;
    await page.mouse.up();
    await expect(page.locator(".workspace-content")).not.toHaveAttribute(
      "data-resizing",
    );
    await page.evaluate(() => document.activeViewTransition?.finished);
    expect((await messages.boundingBox())?.width).not.toBe(body.width);
    console.log(
      `${side} resize: ${JSON.stringify({ ...measured, layouts, layoutMs })}`,
    );
    expect(measured.count).toBeGreaterThan(30);
    expect(measured.gap).toBeLessThanOrEqual(1);
    expect(layouts).toBeGreaterThan(0);
    expect(layoutMs / layouts).toBeLessThanOrEqual(1000 / 60);
    expect(measured.slow).toBeLessThanOrEqual(0.05);
  }
  await session.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await input.fill("调整窗口时保留的草稿");
  for (const width of [1400, 1200, 1600]) {
    const before = (await page.locator(".messages").boundingBox())?.width;
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(async () => (await page.locator(".messages").boundingBox())?.width)
      .not.toBe(before);
    await expect(input).toHaveValue("调整窗口时保留的草稿");
    await expect
      .poll(() =>
        page
          .locator(".transcript")
          .evaluate(
            (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
          ),
      )
      .toBeLessThanOrEqual(1);
  }
  await frames.dispose();
});

test("Bot panels keep their hierarchy in both themes and panel widths", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(url);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const details = page.getByRole("complementary", {
    name: "Domos的详情",
    exact: true,
  });
  const handle = page.getByRole("separator", { name: "调整详情宽度" });
  await expect(
    page.locator('.workspace-panel[data-side="inspector"]'),
  ).toHaveCSS("translate", "none");
  for (const width of [320, 384, 640]) {
    await page.evaluate(() => document.activeViewTransition?.finished);
    await handle.hover();
    const current = Number(await handle.getAttribute("aria-valuenow"));
    const box = await handle.boundingBox();
    if (!box) throw new Error("Resize handle missing");
    await page.mouse.move(box.x + box.width / 2, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + current - width,
      box.y + 100,
      { steps: 5 },
    );
    await page.mouse.up();
    await expect(handle).toHaveAttribute("aria-valuenow", String(width));
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.evaluate(() => document.fonts.ready);
      await expect(
        details.getByRole("region", { name: "运行", exact: true }),
      ).toBeVisible();
      await expect(
        details.getByRole("region", { name: "能力", exact: true }),
      ).toBeVisible();
      expect(
        await details.evaluate((item) => item.scrollWidth <= item.clientWidth),
      ).toBe(true);
      await details.screenshot({
        path: testInfo.outputPath(`bot-panel-${width}-${theme}.png`),
      });
    }
  }
  await details.getByRole("button", { name: /^记忆(?:\s|$)/ }).click();
  const memoryDialog = page.getByRole("dialog", { name: "记忆" });
  await expect(memoryDialog).toBeVisible();
  await expect(page.locator("#bot-details .panel-page")).toBeVisible();
  await memoryDialog.getByRole("button", { name: "新增记忆" }).click();
  const memory = memoryDialog.getByRole("textbox", {
    name: "内容",
    exact: true,
  });
  await memory.fill("会议记录使用简洁中文。");
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await memory.click();
    await expect(memory).toHaveCSS(
      "background-color",
      theme === "dark" ? "rgb(20, 20, 22)" : "rgb(250, 250, 250)",
    );
    await expect(memory).toHaveCSS("resize", "none");
    await expect(memory).toHaveCSS("scrollbar-width", "thin");
    await expect(memoryDialog.locator("form")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await expect(memory).toHaveCSS("outline-style", "none");
    await memory.press("Tab");
    await expect(
      memoryDialog.getByRole("checkbox", { name: "共享给所有 Bot" }),
    ).toBeFocused();
    const save = memoryDialog.getByRole("button", {
      name: "保存",
      exact: true,
    });
    await expect(save).toBeEnabled();
    if (theme === "dark") {
      const channels = await save.evaluate(
        (item) =>
          getComputedStyle(item).backgroundColor.match(/\d+/g)?.map(Number) ??
          [],
      );
      expect(channels).toHaveLength(3);
      expect(Math.max(...channels)).toBeLessThan(100);
    }
    await memoryDialog.screenshot({
      path: testInfo.outputPath(`memory-editor-${theme}.png`),
    });
  }
  await memoryDialog.getByRole("button", { name: "保存", exact: true }).click();
  const entry = memoryDialog.getByRole("button", {
    name: "会议记录使用简洁中文。",
    exact: true,
  });
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(memoryDialog.locator(".item-list")).toHaveCount(0);
  await expect(
    memoryDialog.getByRole("textbox", { name: "内容", exact: true }),
  ).toHaveValue("会议记录使用简洁中文。");
  await memoryDialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(entry).toBeVisible();
  await memoryDialog.screenshot({
    path: testInfo.outputPath("memory-list.png"),
  });
  await memoryDialog.getByRole("button", { name: "关闭弹窗" }).click();
  await details.getByRole("button", { name: /^记忆(?:\s|$)/ }).click();
  await expect(memoryDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(memoryDialog).toBeHidden();
  await expect(
    details.getByRole("button", { name: /^记忆(?:\s|$)/ }),
  ).toBeFocused();
  await details.getByRole("button", { name: /^技能(?:\s|$)/ }).click();
  await details.screenshot({ path: testInfo.outputPath("skills-list.png") });
  await details.getByRole("button", { name: "新建技能", exact: true }).click();
  await details.screenshot({
    path: testInfo.outputPath("skill-editor-dark.png"),
  });
  await expect(
    details.getByRole("button", { name: "导入", exact: true }),
  ).toHaveCount(0);
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await expect(
    details.getByRole("button", { name: "导入", exact: true }),
  ).toBeVisible();
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await details.getByRole("button", { name: /^定时(?:\s|$)/ }).click();
  await details.screenshot({ path: testInfo.outputPath("routine-list.png") });
  await details
    .getByRole("button", { name: "新建定时任务", exact: true })
    .click();
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(
      details.getByRole("textbox", { name: "工作要求与交付方式", exact: true }),
    ).toHaveCSS(
      "background-color",
      theme === "dark" ? "rgb(20, 20, 22)" : "rgb(250, 250, 250)",
    );
    await details.screenshot({
      path: testInfo.outputPath(`routine-editor-${theme}.png`),
    });
  }
  await expect(details.getByText("运行记录", { exact: true })).toHaveCount(0);
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await expect(details.getByText("运行记录", { exact: true })).toBeVisible();
});

test("contacts snap to an icon column and restore their width without losing chat state", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1600, height: 960 });
  await page.goto(url);
  const workspace = page.locator(".workspace");
  const sidebar = page.locator('.workspace-panel[data-side="sidebar"]');
  const handle = page.getByRole("separator", { name: "调整联系人宽度" });
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await input.fill("收起侧栏仍保留的草稿");
  const box = await handle.boundingBox();
  const width = Number(await handle.getAttribute("aria-valuenow"));
  if (!box) throw new Error("Contact resize handle missing");
  const x = box.x + box.width / 2;
  const y = box.y + 120;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 208 - width, y, { steps: 4 });
  await expect(handle).toHaveAttribute("aria-valuenow", "208");
  await workspace.evaluate((root) => {
    const panel = root.querySelector('.workspace-panel[data-side="sidebar"]');
    const chat = root.querySelector(".conversation");
    if (!panel || !chat) throw new Error("Workspace missing");
    const avatar = root.querySelector(".contact-row .bot-avatar");
    if (!avatar) throw new Error("Contact avatar missing");
    const frames: [number, number, number][] = [];
    root.setAttribute("data-sampling", "true");
    const sample = () => {
      const box = panel.getBoundingClientRect();
      frames.push([
        box.width,
        Math.abs(box.right - chat.getBoundingClientRect().left),
        avatar.getBoundingClientRect().top,
      ]);
      root.setAttribute("data-snap-frames", JSON.stringify(frames));
      if (root.hasAttribute("data-sampling")) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.mouse.move(x + 176 - width, y);
  await expect(workspace).toHaveAttribute("data-sidebar-compact", "true");
  await expect(handle).toHaveAttribute("aria-valuenow", "96");
  expect(
    await page.evaluate(() => localStorage.getItem("domos:layout:v1")),
  ).toBeNull();
  await page.mouse.move(x + 200 - width, y);
  await expect(handle).toHaveAttribute("aria-valuenow", "96");
  await page.mouse.up();
  await expect(sidebar).toHaveCSS("width", "96px");
  const snapFrames = await workspace.evaluate((root) => {
    root.removeAttribute("data-sampling");
    return JSON.parse(root.getAttribute("data-snap-frames") ?? "[]") as [
      number,
      number,
      number,
    ][];
  });
  expect(snapFrames.some(([width]) => width > 97 && width < 207)).toBe(true);
  expect(Math.max(...snapFrames.map(([, gap]) => gap))).toBeLessThanOrEqual(1);
  const firstY = snapFrames[0]?.[2];
  const lastY = snapFrames.at(-1)?.[2];
  if (firstY === undefined || lastY === undefined)
    throw new Error("Snap frames missing");
  expect(snapFrames.some(([, , y]) => y > firstY + 1 && y < lastY - 1)).toBe(
    true,
  );
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("domos:layout:v1") ?? "{}"),
  );
  expect(stored).toMatchObject({ sidebar: 208, collapsed: true });
  await expect(sidebar.locator(".chat-preview").first()).toBeHidden();
  await expect(
    sidebar.getByRole("link", { name: "Domos", exact: true }),
  ).toHaveAttribute("title", "Domos");
  await expect(
    sidebar.getByRole("button", { name: "新建 Bot", exact: true }),
  ).toBeVisible();
  await expect(
    sidebar.getByRole("button", { name: "设置", exact: true }),
  ).toBeVisible();
  expect((await sidebar.boundingBox())?.width).toBe(96);
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const contact = sidebar.locator('.contact-row[aria-current="page"]');
    const searchButton = sidebar.getByRole("button", {
      name: "搜索联系人",
      exact: true,
    });
    const contactBox = await contact.boundingBox();
    if (!contactBox) throw new Error("Contact missing");
    expect(contactBox.width).toBeCloseTo(54, 0);
    expect(contactBox.height).toBeCloseTo(contactBox.width, 1);
    expect(Math.abs(contactBox.x + contactBox.width / 2 - 48)).toBeLessThan(1);
    const matchingBackgrounds = async () =>
      (await contact.evaluate(
        (node) => getComputedStyle(node).backgroundColor,
      )) ===
      (await searchButton.evaluate(
        (node) => getComputedStyle(node).backgroundColor,
      ));
    await expect.poll(matchingBackgrounds).toBe(true);
    await searchButton.hover();
    await searchButton.evaluate((node) =>
      Promise.all(node.getAnimations().map((animation) => animation.finished)),
    );
    const hover = await searchButton.evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    );
    await contact.hover();
    await expect(contact).toHaveCSS("background-color", hover);
    await page.mouse.move(400, 800);
    await page.screenshot({
      path: info.outputPath(`contacts-compact-${theme}.png`),
      animations: "disabled",
    });
  }
  await page.reload();
  await expect(workspace).toHaveAttribute("data-sidebar-compact", "true");
  await expect(input).toHaveValue("收起侧栏仍保留的草稿");
  await sidebar
    .getByRole("button", { name: "搜索联系人", exact: true })
    .click();
  const search = sidebar.getByRole("searchbox");
  await expect(search).toBeFocused();
  await expect(handle).toHaveAttribute("aria-valuenow", "208");
  await search.fill("不存在的联系人");
  await handle.dblclick();
  await expect(workspace).toHaveAttribute("data-sidebar-compact", "true");
  await handle.dblclick();
  await expect(search).toHaveValue("不存在的联系人");
  await search.fill("");
  await handle.press("Home");
  await expect(handle).toHaveAttribute("aria-valuenow", "96");
  await expect(sidebar).toHaveCSS("width", "96px");
  const rail = await handle.boundingBox();
  if (!rail) throw new Error("Compact resize handle missing");
  await page.mouse.move(rail.x + rail.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(rail.x + rail.width / 2 + 144, y, { steps: 5 });
  await expect(handle).toHaveAttribute("aria-valuenow", "240");
  await page.mouse.up();
  await expect(sidebar).toHaveCSS("width", "240px");
  await handle.press("Home");
  await expect(handle).toHaveAttribute("aria-valuenow", "96");
  await workspace.evaluate((root) => {
    const panel = root.querySelector('.workspace-panel[data-side="sidebar"]');
    if (!panel) throw new Error("Sidebar missing");
    for (const animation of [
      ...root.getAnimations(),
      ...panel.getAnimations(),
    ]) {
      if (!(animation instanceof CSSTransition)) continue;
      animation.pause();
      animation.currentTime = 80;
    }
  });
  const moving = await handle.boundingBox();
  const currentWidth = (await sidebar.boundingBox())?.width;
  if (!moving || !currentWidth) throw new Error("Moving sidebar missing");
  expect(currentWidth).toBeGreaterThan(96);
  expect(currentWidth).toBeLessThan(240);
  await page.mouse.move(moving.x + moving.width / 2, y);
  await page.mouse.down();
  expect((await sidebar.boundingBox())?.width).toBeCloseTo(currentWidth, 0);
  await page.mouse.move(moving.x + moving.width / 2 + 150, y);
  await expect(handle).toHaveAttribute(
    "aria-valuenow",
    String(Math.round(currentWidth + 150)),
  );
  expect((await sidebar.boundingBox())?.width).toBeCloseTo(
    currentWidth + 150,
    0,
  );
  await page.mouse.up();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await handle.press("Home");
  await handle.press("ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", "232");
  await expect(sidebar).toHaveCSS("width", "232px");
  await expect(workspace).not.toHaveAttribute("data-sidebar-snapping");
  expect(await workspace.evaluate((root) => root.getAnimations().length)).toBe(
    0,
  );
  await handle.press("Home");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "联系人", exact: true }).click();
  await expect(sidebar.getByRole("searchbox")).toBeVisible();
  await expect(sidebar.locator(".chat-preview").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1600, height: 960 });
  await expect(workspace).toHaveAttribute("data-sidebar-compact", "true");
  await expect(input).toHaveValue("收起侧栏仍保留的草稿");
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
  const details = page.getByRole("complementary", { name: /的详情$/ });
  await details.getByRole("button", { name: "编辑", exact: true }).click();
  const name = page.getByRole("textbox", { name: "名字", exact: true });
  await name.fill("尚未保存的名字");
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await page.getByRole("tab", { name: "Computer", exact: true }).click();
  await page.getByRole("button", { name: "电脑设置", exact: true }).click();
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await details.getByRole("tab", { name: "Bot", exact: true }).click();
  await details.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(name).toHaveValue("尚未保存的名字");
  const right = page.getByRole("separator", { name: "调整详情宽度" });
  const inspectorPanel = page.locator(
    '.workspace-panel[data-side="inspector"]',
  );
  await expect(inspectorPanel).toHaveCSS("border-inline-start-width", "1px");
  await expect(page.locator(".chat-header")).toHaveCSS(
    "border-bottom-width",
    "0px",
  );
  await expect(inspectorPanel).toHaveCSS("border-inline-start-width", "1px");
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
  await details.getByRole("button", { name: "编辑", exact: true }).click();
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
      settings.getByRole("tab", { name: "Providers", exact: true }),
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
  await expect(page.locator("#bot-details")).toBeVisible();
  await trigger.click();
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

test("empty chats retain their creation time and compact controls across layouts", async ({
  page,
}) => {
  await page.goto(url);
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
  await expect(page.getByRole("searchbox")).toHaveAttribute(
    "placeholder",
    "搜索",
  );
  await page.reload();
  await expect(time).toHaveAttribute("datetime", createdAt ?? "");
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await page.getByRole("tab", { name: "Computer", exact: true }).click();
  await page.getByRole("button", { name: "电脑设置", exact: true }).click();
  const details = page.getByRole("complementary", { name: "Domos的详情" });
  await expect(
    details.getByRole("combobox", { name: "此 Bot 使用的电脑", exact: true }),
  ).toBeVisible();
  await details
    .getByRole("button", { name: "准备新电脑", exact: true })
    .click();
  const environment = page.getByRole("dialog", {
    name: "Bot 在哪里工作？",
    exact: true,
  });
  await expect(
    environment.getByRole("radiogroup", { name: "此 Bot 的工作环境" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(environment).toBeHidden();
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await details.getByRole("tab", { name: "Bot", exact: true }).click();
  await details.getByRole("button", { name: "编辑", exact: true }).click();
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
  await create.getByRole("button", { name: "创建", exact: true }).click();
  await create.getByRole("button", { name: "授权并继续", exact: true }).click();
  const modelDialog = create;
  await modelDialog
    .getByRole("combobox", { name: "模型", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Pi · 测试模型一", exact: true })
    .click();
  await create.getByRole("button", { name: "开始", exact: true }).click();
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
  await page.getByRole("button", { name: "新建 Bot", exact: true }).click();
  create = page.getByRole("dialog", { name: "新建 Bot", exact: true });
  const longName = "负责跨语言内容审校与排版的 Editorial Assistant";
  await create
    .getByRole("textbox", { name: "名字", exact: true })
    .fill(longName);
  await create.getByRole("button", { name: "创建", exact: true }).click();
  await create.getByRole("button", { name: "授权并继续", exact: true }).click();
  await modelDialog
    .getByRole("combobox", { name: "模型", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Pi · 测试模型一", exact: true })
    .click();
  await create.getByRole("button", { name: "开始", exact: true }).click();
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
  await page.mouse.move(400, 800);
  await expect(active).toHaveAttribute("aria-current", "page");
  await root.hover();
  await expect(root).not.toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(root).toContainText("已收到：核对列表预览");
});

test("control geometry and interaction states stay consistent", async ({
  page,
}) => {
  await page.goto(url);
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
  const select = details.getByRole("combobox", {
    name: "此 Bot 使用的电脑",
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
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("main", { name: "设置", exact: true });
  const nav = settings.getByRole("tablist", { name: "设置分区" });
  await expect(nav).toHaveAttribute("aria-orientation", "vertical");
  const appearance = settings.getByRole("tab", { name: "通用", exact: true });
  const computer = settings.getByRole("tab", {
    name: "Providers",
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
    settings.getByRole("tab", { name: "Providers", exact: true }),
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
  const sidebar = page.locator('.workspace-panel[data-side="sidebar"]');
  await expect(sidebar).toHaveCSS("width", `${min}px`);
  await handle.hover();
  const box = await handle.boundingBox();
  if (!box) throw new Error("Resize handle missing");
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 180, box.y + 100);
  await expect(handle).toHaveAttribute("aria-valuenow", "276");
  await expect(page.locator(".workspace-content")).toHaveAttribute(
    "data-resizing",
    "true",
  );
  await handle.dispatchEvent("pointercancel");
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", min ?? "");
  await expect(page.locator(".workspace-content")).not.toHaveAttribute(
    "data-resizing",
  );
  await handle.press("ArrowRight");
  await expect
    .poll(async () => Number(await handle.getAttribute("aria-valuenow")))
    .toBeGreaterThan(Number(min));
  await expect(sidebar).toHaveCSS("width", "232px");
  await handle.hover();
  const expanded = await handle.boundingBox();
  if (!expanded) throw new Error("Resize handle missing");
  await page.mouse.move(expanded.x + expanded.width / 2, expanded.y + 100);
  await page.mouse.down();
  await expect(page.locator(".workspace-content")).toHaveAttribute(
    "data-resizing",
    "true",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".workspace-content")).not.toHaveAttribute(
    "data-resizing",
  );
  await page.mouse.up();
});

test("panel transitions preserve the transcript and draft through rapid toggles and reduced motion", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const receipt = once(worker, "message");
  worker.send({ history: 160 });
  await receipt;
  await page.setViewportSize({ width: 1620, height: 940 });
  await page.goto(url);
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await input.fill("保留这份草稿");
  await expect(page.locator(".message")).toHaveCount(120);
  await page.evaluate(() => {
    const frames: {
      time: number;
      visible: number;
      gap: number;
      transitions: number;
    }[] = [];
    document.documentElement.dataset.panelRecording = "true";
    const sample = (time: number) => {
      const viewport = document.querySelector<HTMLElement>(".transcript");
      if (!viewport) throw new Error("Transcript missing");
      const rect = viewport.getBoundingClientRect();
      frames.push({
        time,
        visible: Array.from(document.querySelectorAll(".message")).filter(
          (node) => {
            const row = node.getBoundingClientRect();
            return row.bottom > rect.top && row.top < rect.bottom;
          },
        ).length,
        gap: viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop,
        transitions: document
          .getAnimations()
          .filter(
            (animation) =>
              animation.effect instanceof KeyframeEffect &&
              animation.effect.pseudoElement?.includes(
                "view-transition-group",
              ) &&
              animation.effect.getTiming().duration === 220,
          ).length,
      });
      document.documentElement.dataset.panelFrames = JSON.stringify(frames);
      if (document.documentElement.dataset.panelRecording === "true")
        requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const trigger = page.getByRole("button", { name: "Bot详情", exact: true });
  const close = page
    .locator("#bot-details")
    .getByRole("button", { name: "关闭", exact: true });
  await close.click();
  for (let index = 0; index < 3; index++) {
    await trigger.click();
    await close.click();
  }
  await expect(
    page.locator(".workspace-panel[data-side=inspector]"),
  ).toBeHidden();
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          !(animation.effect instanceof KeyframeEffect) ||
          !animation.effect.pseudoElement?.includes("view-transition"),
      ),
  );
  const frames = await page.evaluate(() => {
    document.documentElement.dataset.panelRecording = "false";
    return JSON.parse(document.documentElement.dataset.panelFrames ?? "[]") as {
      time: number;
      visible: number;
      gap: number;
      transitions: number;
    }[];
  });
  expect(frames.some((frame) => frame.transitions > 0)).toBe(true);
  expect(frames.every((frame) => frame.visible > 0 && frame.gap <= 2)).toBe(
    true,
  );
  await expect(input).toHaveValue("保留这份草稿");
  await expect(page.locator(".message")).toHaveCount(120);
  await writeFile(
    info.outputPath("panel-frames.json"),
    JSON.stringify(frames, null, 2),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [1360, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await trigger.click();
    const panel = page.locator(".workspace-panel[data-side=inspector]");
    await expect(panel).toBeVisible();
    expect(
      await panel.evaluate((node) => getComputedStyle(node).transitionDuration),
    ).toBe("0s");
    await page.screenshot({ path: info.outputPath(`panel-${width}.png`) });
    await panel.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(panel).toBeHidden();
    await expect(input).toHaveValue("保留这份草稿");
  }
});

test("Work follows a native turn, opens its record and preserves it after stop and reload", async ({
  page,
}, info) => {
  worker.send("gate");
  await once(worker, "message");
  await page.goto(url);
  await page.getByRole("tab", { name: "Work", exact: true }).click();
  await page.getByLabel("消息", { exact: true }).fill("检查 Work 工作记录");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const card = page.locator(".work-row").first();
  await expect(
    card.getByRole("button", { name: "停止执行", exact: true }),
  ).toBeVisible();
  await expect(card.locator(".work-mark")).toHaveAttribute(
    "data-state",
    "running",
  );
  expect((await card.boundingBox())?.height).toBe(60);
  const background = await card
    .locator(".work-open")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  await card.locator(".work-open").hover();
  await expect
    .poll(() =>
      card
        .locator(".work-open")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    )
    .toBe(background);
  await page.screenshot({ path: info.outputPath("work-running.png") });
  await card.locator(".work-open").click();
  const dialog = page.getByRole("dialog", { name: "工作记录", exact: true });
  await expect(dialog).toContainText("检查 Work 工作记录");
  await page.keyboard.press("Escape");
  await expect(card.locator(".work-open")).toBeFocused();
  await card.getByRole("button", { name: "停止执行", exact: true }).click();
  await expect(card).toContainText("已停止");
  await expect(dialog).not.toBeVisible();
  await expect(card.locator(".work-mark")).not.toHaveAttribute("data-state");
  await page.reload();
  await page.getByRole("tab", { name: "Work", exact: true }).click();
  await expect(card).toContainText("已停止");
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await card.locator(".work-open").click();
    await expect(dialog).toHaveCSS(
      "background-color",
      theme === "dark" ? "rgb(15, 15, 16)" : "rgb(250, 250, 250)",
    );
    await page.screenshot({
      path: info.outputPath(`work-dialog-${theme}.png`),
    });
    await page.keyboard.press("Escape");
    await page.screenshot({ path: info.outputPath(`work-${theme}.png`) });
  }
  await card.locator(".work-open").click();
  await expect(dialog).toContainText("已停止");
  await page.keyboard.press("Escape");
  worker.send({
    content: [
      { type: "thinking", thinking: "核对原生记录。" },
      {
        type: "toolCall",
        id: "work-tool",
        name: toolName,
        arguments: { text: "原生工具回执" },
      },
    ],
    stopReason: "toolUse",
  });
  await once(worker, "message");
  await page.getByLabel("消息", { exact: true }).fill("检查原生工具");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(card).toContainText("执行已结束");
  await expect(page.locator(".work-row")).toHaveCount(2);
  await expect(card).toHaveCSS("border-width", "1px");
  await expect(page.locator(".work-list")).toHaveCSS("border-width", "0px");
  const cards = await page.locator(".work-row").all();
  const first = await cards[0]?.boundingBox();
  const second = await cards[1]?.boundingBox();
  if (!first || !second) throw new Error("Work cards missing");
  expect(second.y - first.y - first.height).toBe(8);
  await card.locator(".work-open").click();
  await dialog.locator("summary").filter({ hasText: "原生思考" }).click();
  await expect(dialog).toContainText("核对原生记录。");
  await dialog.locator("summary").filter({ hasText: toolName }).click();
  await expect(
    dialog.locator("pre").filter({ hasText: "原生工具回执" }),
  ).toBeVisible();
  await expect(dialog).toContainText("原生工具回执");
  await page.screenshot({ path: info.outputPath("work-detail.png") });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await card.boundingBox())?.height).toBe(60);
  const label = card.locator(".work-label");
  await expect(label).toHaveCSS("min-width", "0px");
  await expect(label.locator("span").first()).toHaveCSS(
    "text-overflow",
    "ellipsis",
  );
  await page.screenshot({ path: info.outputPath("work-narrow.png") });
});

test("shared question and approval cards persist answers and terminal states", async ({
  page,
}, info) => {
  await page.goto(url);
  const options = [
    { id: "a", label: "第一项" },
    { id: "b", label: "第二项" },
  ];
  for (const mode of [
    "custom",
    "multiple",
    "approve",
    "deny",
    "expire",
  ] as const) {
    const title = `确认 ${mode}`;
    worker.send({
      approval: {
        id: mode,
        kind:
          mode === "custom" || mode === "multiple" ? "question" : "permission",
        title,
        detail: mode === "approve" ? "测试操作参数" : "",
        questions:
          mode === "custom" || mode === "multiple"
            ? [
                {
                  id: "q",
                  title,
                  options,
                  allowOther: true,
                  multiple: mode === "multiple",
                },
              ]
            : undefined,
      },
    });
    const card = page.getByRole("region", { name: title, exact: true });
    await expect(card).toBeVisible();
    await page.reload();
    const reply = new Promise<{
      type: string;
      answer: { answers: Record<string, string[]> };
    }>((resolve) => {
      const receive = (value: {
        type: string;
        answer: { answers: Record<string, string[]> };
      }) => {
        if (value.type !== "answered") return;
        worker.off("message", receive);
        resolve(value);
      };
      worker.on("message", receive);
    });
    if (mode === "custom") {
      await card
        .getByRole("button", { name: "自定义回答", exact: true })
        .click();
      await expect(
        card.getByRole("button", { name: "发送回答", exact: true }),
      ).toBeDisabled();
      await card
        .getByRole("textbox", { name: "你的回答", exact: true })
        .fill("我自己选择");
      await card.getByRole("button", { name: "发送回答", exact: true }).click();
    } else if (mode === "multiple") {
      await card.getByRole("button", { name: "A 第一项", exact: true }).click();
      await card.getByRole("button", { name: "B 第二项", exact: true }).click();
      await expect(card).toHaveAttribute("data-state", "pending");
      await card.getByRole("button", { name: "发送回答", exact: true }).click();
    } else if (mode === "expire") worker.send("release");
    else
      await card
        .getByRole("button", {
          name: mode === "approve" ? "批准" : "拒绝",
          exact: true,
        })
        .click();
    const result = await reply;
    expect(result.type).toBe("answered");
    if (mode === "custom")
      expect(result.answer.answers).toEqual({ q: ["我自己选择"] });
    if (mode === "multiple")
      expect(result.answer.answers).toEqual({ q: ["a", "b"] });
    const expected =
      mode === "expire"
        ? "已失效"
        : mode === "deny"
          ? "已拒绝"
          : mode === "approve"
            ? "已批准"
            : "已回答";
    await expect(card.getByRole("status")).toHaveText(expected);
    await page.reload();
    await expect(card.getByRole("status")).toHaveText(expected);
  }
  for (const width of [1360, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole("region", { name: "确认 expire", exact: true }),
    ).toBeInViewport();
    if (width === 390) {
      const inspector = page.getByRole("complementary", { name: /的详情$/ });
      await inspector
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      await expect(inspector).not.toBeVisible();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`interactions-${width}.png`),
    });
  }
});

test("skill packages preview changes and restore resources across reload", async ({
  page,
}, info) => {
  const { zipSync, strToU8 } = createRequire(
    new URL("../../../packages/agent/package.json", import.meta.url),
  )("fflate");
  const content =
    "---\nname: weekly-report\ndescription: Prepare a weekly report\n---\nRead references/guide.md. Run scripts/report.py.";
  const bundle = (script: string) =>
    Buffer.from(
      zipSync({
        "weekly-report/SKILL.md": strToU8(content),
        "weekly-report/references/guide.md": strToU8("Report guide"),
        "weekly-report/scripts/report.py": strToU8(script),
      }),
    );
  await page.goto(url);
  const details = page.locator("#bot-details");
  await details.getByRole("button", { name: /^技能(?:\s|$)/ }).click();
  const upload = async (script: string) => {
    await expect(details.getByLabel("导入技能包")).toBeEnabled();
    await details.getByLabel("导入技能包").setInputFiles({
      name: "weekly-report.zip",
      mimeType: "application/zip",
      buffer: bundle(script),
    });
    await expect(
      details
        .getByLabel("编辑 SKILL.md")
        .or(details.getByLabel("新建 SKILL.md")),
    ).toHaveValue(content);
    await details
      .getByRole("button", { name: "保存技能", exact: true })
      .click();
    await expect(
      details.getByRole("region", { name: "技能差异" }),
    ).toContainText("scripts/report.py");
    await details
      .getByRole("button", { name: "保存技能", exact: true })
      .click();
    await expect(
      details.getByRole("heading", { name: "weekly-report", exact: true }),
    ).toBeVisible();
  };
  await upload("print('v1')");
  let releaseEnable!: () => void;
  const enabling = page.waitForRequest("**/rpc/work/skills/enable");
  const enableGate = new Promise<void>((resolve) => {
    releaseEnable = resolve;
  });
  await page.route("**/rpc/work/skills/enable", async (route) => {
    await enableGate;
    await route.continue();
  });
  await details
    .getByRole("switch", { name: "为此 Bot 启用 weekly-report" })
    .click();
  await enabling;
  await expect(details.getByLabel("导入技能包")).toBeDisabled();
  releaseEnable();
  await upload("print('v2')");
  await page.reload();
  await page
    .locator("#bot-details")
    .getByRole("button", { name: /^技能(?:\s|$)/ })
    .click();
  await details
    .getByRole("button")
    .filter({
      has: page.getByRole("heading", { name: "weekly-report", exact: true }),
    })
    .click();
  await details.getByText("版本历史", { exact: true }).click();
  await details.getByRole("button", { name: /^预览 v1/ }).click();
  const diff = details.getByRole("region", { name: "技能差异" });
  await diff.getByText("修改 · scripts/report.py", { exact: true }).click();
  await expect(diff).toContainText("print('v1')");
  await expect(diff).toContainText("print('v2')");
  await details.screenshot({
    path: info.outputPath("skill-version-preview.png"),
  });
  await details.getByRole("button", { name: "保存技能", exact: true }).click();
  await expect(details.getByText("user · v3", { exact: true })).toBeVisible();
  await expect(
    details.getByRole("switch", { name: "为此 Bot 启用 weekly-report" }),
  ).toBeChecked();
});

test("chat routine changes require confirmation and link runs to Work", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  await page.goto(url);
  const details = page.locator("#bot-details");
  const sendTool = async (name: string, args: Record<string, unknown>) => {
    const ready = once(worker, "message");
    worker.send({
      content: [
        { type: "toolCall", id: crypto.randomUUID(), name, arguments: args },
      ],
      stopReason: "toolUse",
    });
    await ready;
    await page.getByLabel("消息", { exact: true }).fill(name);
    await page.getByRole("button", { name: "发送", exact: true }).click();
  };
  await sendTool("routine_create", {
    title: "Daily report",
    instructions: "Read the daily report",
    schedule: {
      type: "cron",
      expression: "0 8 * * *",
      timeZone: "Asia/Shanghai",
    },
    executionMs: 60_000,
  });
  const create = page.getByRole("region", {
    name: "创建定时：Daily report",
    exact: true,
  });
  await expect(create).toBeVisible();
  await details.getByRole("button", { name: /^定时(?:\s|$)/ }).click();
  await expect(
    details.getByText("暂无定时任务", { exact: true }),
  ).toBeVisible();
  await create.getByRole("button", { name: "批准", exact: true }).click();
  await expect(
    details.getByRole("switch", { name: "启用 Daily report" }),
  ).toBeChecked();
  await expect(create.getByRole("status")).toHaveText("已批准");
  await page.reload();
  await expect(create.getByRole("status")).toHaveText("已批准");
  await page
    .locator("#bot-details")
    .getByRole("button", { name: /^定时(?:\s|$)/ })
    .click();
  await details.getByRole("button", { name: "Daily report的操作" }).click();
  await page.getByRole("menuitem", { name: "试跑", exact: true }).click();
  await details.locator("summary").filter({ hasText: "运行记录" }).click();
  await expect(details.locator(".run-list")).toContainText("已完成");
  await expect(details.locator(".run-list")).toContainText("等人");
  await details
    .getByRole("button", { name: "查看工作记录", exact: true })
    .click();
  const record = page.getByRole("dialog", { name: "工作记录", exact: true });
  await expect(record).toContainText("试跑：Daily report");
  await record.locator("summary").filter({ hasText: "回复" }).click();
  await expect(record).toContainText("Read the daily report");
  await page.screenshot({ path: info.outputPath("routine-work-record.png") });
});
