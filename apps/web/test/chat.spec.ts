import { type ChildProcess, fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

let worker: ChildProcess;
let url: string;
let database: string;
let directory: string;
let toolName: string;

async function start(port = 0) {
  worker = fork(
    fileURLToPath(
      new URL("../../api/test/fixtures/web-server.ts", import.meta.url),
    ),
    [database, String(port)],
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
  command: string | { content: unknown; stopReason?: "stop" | "toolUse" },
) {
  const receipt = once(worker, "message");
  worker.send(command);
  await receipt;
}

async function expectTextContrast(page: import("@playwright/test").Page) {
  const ratios = await page.evaluate(() => {
    const luminance = (color: string) => {
      const channels = (color.match(/[\d.]+/g) ?? [])
        .slice(0, 3)
        .map(Number)
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
        ".sidebar-label, .sidebar-footer, .model-picker select, .appearance-picker select",
      ),
    ].map((element) => {
      let background: Element | null = element;
      while (
        background &&
        getComputedStyle(background).backgroundColor === "rgba(0, 0, 0, 0)"
      )
        background = background.parentElement;
      const foreground = luminance(getComputedStyle(element).color);
      if (!background) throw new Error("Missing opaque background");
      const surface = luminance(getComputedStyle(background).backgroundColor);
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

test("model choices load from the server and selection survives a restart", async ({
  page,
}) => {
  const subscription = Promise.withResolvers<void>();
  await page.route("**/rpc/subscribe", async (route) => {
    await subscription.promise;
    await route.continue();
  });
  await page.goto(url);
  const picker = page.getByRole("combobox", { name: "模型", exact: true });
  await expect(picker).toBeDisabled();
  await expect(picker).not.toContainText("DeepSeek");
  subscription.resolve();
  await expect(picker).toBeEnabled();
  await picker.selectOption({ label: "faux · 测试模型二" });
  await expect(picker).toHaveValue(JSON.stringify(["faux", "faux-2"]));
  await page.reload();
  await expect(picker).toHaveValue(JSON.stringify(["faux", "faux-2"]));
  const port = Number(new URL(url).port);
  await stop();
  await start(port);
  await expect(picker).toBeEnabled();
  await page.getByLabel("消息", { exact: true }).fill("验证模型选择");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByLabel("Domos 的回复")).toContainText("faux-2");
});

test("send, reload, disconnect, reconnect and restart preserve the conversation", async ({
  page,
}) => {
  await page.goto(url);
  await expect(
    page.getByRole("combobox", { name: "模型", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: "test-results/chat-desktop.png" });
  await control("gate");
  await page.getByLabel("消息", { exact: true }).fill("记住这句话");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("你的消息")).toContainText("记住这句话");
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  await page.goto("about:blank");
  await control("release");
  await page.goto(url);
  await expect(page.getByLabel("Domos 的回复")).toContainText("已收到");
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  await expect(page.getByLabel("Domos 的回复")).toContainText("完整回复。");
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/chat-conversation.png" });
  const port = Number(new URL(url).port);
  await stop();
  await start(port);
  await expect(
    page.getByRole("combobox", { name: "模型", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("Domos 的回复")).toContainText("记住这句话");
  await expect(page.getByLabel("你的消息")).toHaveCount(1);
});

test("a killed server resumes unfinished work and the page reconnects", async ({
  page,
}) => {
  await page.goto(url);
  await expect(
    page.getByRole("combobox", { name: "模型", exact: true }),
  ).toBeEnabled();
  await control("gate");
  await page.getByLabel("消息", { exact: true }).fill("恢复未完成任务");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  const port = Number(new URL(url).port);
  await stop();
  await start(port);
  await expect(page.getByLabel("Domos 的回复")).toContainText("完整回复。");
  await expect(page.getByLabel("你的消息")).toHaveCount(1);
  await expect(
    page.getByRole("combobox", { name: "模型", exact: true }),
  ).toBeEnabled();
});

test("stop and Chinese input work on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await expect(
    page.getByRole("combobox", { name: "模型", exact: true }),
  ).toBeEnabled();
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
  await expect(input).toHaveValue("中文输入\n");
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
  await expect(
    page.getByRole("combobox", { name: "模型", exact: true }),
  ).toBeEnabled();
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
  await expect(page.getByLabel("消息", { exact: true })).toHaveValue("");
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
  await expect(input).toHaveValue("尚未发送的想法");
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(url);
  await expect(reopened.getByLabel("消息", { exact: true })).toHaveValue(
    "尚未发送的想法",
  );
  await expect(reopened.getByLabel("你的消息")).toHaveCount(0);
});

test("editing during a send preserves the next draft", async ({ page }) => {
  await page.goto(url);
  await expect(
    page.getByRole("combobox", { name: "模型", exact: true }),
  ).toBeEnabled();
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
  await input.fill("下一条草稿");
  receipt.resolve();
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue("下一条草稿");
  await page.reload();
  await expect(input).toHaveValue("下一条草稿");
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
  await expect(
    page.getByRole("combobox", { name: "模型", exact: true }),
  ).toBeEnabled();
  const input = page.getByLabel("消息", { exact: true });
  await input.fill("保留在输入框");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("草稿保存失败");
  await expect(input).toHaveValue("保留在输入框");
  await expect(page.getByLabel("你的消息")).toHaveCount(0);
});

test("a busy conversation shows the server rejection and keeps the draft", async ({
  page,
  browser,
}) => {
  await page.goto(url);
  await expect(
    page.getByRole("combobox", { name: "模型", exact: true }),
  ).toBeEnabled();
  const other = await browser.newPage();
  await other.goto(url);
  await expect(
    other.getByRole("combobox", { name: "模型", exact: true }),
  ).toBeEnabled();
  await control("gate");
  await page.route("**/rpc/send", async (route) => {
    await other.getByLabel("消息", { exact: true }).fill("占用会话");
    await other.getByRole("button", { name: "发送", exact: true }).click();
    await expect(other.getByRole("button", { name: "停止生成" })).toBeVisible();
    await route.continue();
  });
  await page.getByLabel("消息", { exact: true }).fill("被拒绝的消息");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("会话正在回复");
  await expect(page.getByRole("alert")).not.toContainText("发送未确认");
  await expect(page.getByLabel("消息", { exact: true })).toHaveValue(
    "被拒绝的消息",
  );
  await page.unroute("**/rpc/send");
  await other.getByRole("button", { name: "停止生成" }).click();
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeVisible();
  await other.close();
});

test("text contrast, keyboard focus and message scrolling meet the UI contract", async ({
  page,
}) => {
  await page.goto(url);
  await expect(
    page.getByRole("combobox", { name: "模型", exact: true }),
  ).toBeEnabled();
  await expectTextContrast(page);
  const picker = page.getByRole("combobox", { name: "模型", exact: true });
  const restingBorder = await page
    .locator(".message-composer")
    .evaluate((element) => getComputedStyle(element).borderColor);
  await picker.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("combobox", { name: "外观" })).toBeFocused();
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
    .not.toBe(restingBorder);
  await input.fill("长消息".repeat(400));
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  await page.locator(".transcript").evaluate((element) => {
    element.scrollTop = 0;
  });
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
  const appearance = page.getByRole("combobox", { name: "外观" });
  await expect(appearance).toHaveValue("system");
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(root).toHaveAttribute("data-theme", "dark");
  await appearance.selectOption("light");
  await page.reload();
  await expect(appearance).toHaveValue("light");
  await expect(root).toHaveAttribute("data-theme", "light");
  const other = await context.newPage();
  await other.goto(url);
  await expect(other.getByRole("combobox", { name: "外观" })).toHaveValue(
    "light",
  );
  await appearance.selectOption("dark");
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
  await page.getByRole("combobox", { name: "外观" }).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(
    page.getByRole("alert").filter({ hasText: "外观已应用" }),
  ).toBeVisible();
});

test("composer grows, shrinks, and keeps one focus surface in both themes", async ({
  page,
}) => {
  await page.goto(url);
  await expect(
    page.getByRole("combobox", { name: "模型", exact: true }),
  ).toBeEnabled();
  const input = page.getByLabel("消息", { exact: true });
  const form = page.locator(".message-composer");
  const initial = await form.boundingBox();
  expect(initial?.height).toBeLessThan(75);
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
  for (const theme of ["light", "dark"]) {
    await page.getByRole("combobox", { name: "外观" }).selectOption(theme);
    await expectTextContrast(page);
    await input.focus();
    await expect(input).toHaveCSS("outline-style", "none");
    await page.screenshot({ path: `test-results/workspace-${theme}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(input).toBeVisible();
  await expect(page.getByRole("combobox", { name: "外观" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/workspace-mobile.png" });
});

test("structured messages show Markdown, thinking, tool states, and restored results", async ({
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
  await expect(
    page.getByRole("combobox", { name: "模型", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("消息", { exact: true }).fill("检查排版");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const response = page.getByLabel("Domos 的回复");
  await expect(response.locator("strong")).toHaveText("重点");
  await expect(response.getByRole("table")).toBeVisible();
  await expect(response.locator("pre code")).toHaveText("const ready = true;");
  await response.getByText("思考过程", { exact: true }).click();
  await expect(
    response.getByText("核对已有资料。", { exact: true }),
  ).toBeVisible();
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
  await expect(page.getByText("等待结果", { exact: true })).toBeVisible();
  await control("release");
  await expect(page.getByText("执行失败", { exact: true })).toBeVisible();
  const result = page.getByLabel("返回结果", { exact: true });
  await result.locator("summary").click();
  await expect(result.locator("strong")).toHaveText("工具结果");
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/workspace-content.png" });
  await page.reload();
  await expect(page.getByText("执行失败", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "调研结果" })).toBeVisible();
});

test("measured text sizing grows with wrapping and resets after clearing", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const supports = CSS.supports.bind(CSS);
    CSS.supports = ((property: string, value?: string) =>
      property === "field-sizing"
        ? false
        : value === undefined
          ? supports(property)
          : supports(property, value)) as typeof CSS.supports;
  });
  await page.goto(url);
  await page.addStyleTag({
    content: ".message-composer textarea { field-sizing: fixed; }",
  });
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
  await input.fill("");
  await expect
    .poll(async () => (await input.boundingBox())?.height)
    .toBe(initial?.height);
});
