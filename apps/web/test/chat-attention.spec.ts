import assert from "node:assert/strict";
import { type ChildProcess, fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { expect, test } from "@playwright/test";
import type { AppRouter } from "../../api/src/router.ts";

let worker: ChildProcess;
let directory: string;
let url: string;
let rpc: RouterClient<AppRouter>;
async function seed(input: object) {
  const done = once(worker, "message");
  worker.send(input);
  await done;
}
const message = (index: number, text = `查找报告 ${index}`) => ({
  id: `saved:${index}`,
  turnId: `turn:${index}`,
  role: "assistant",
  stopped: false,
  timestamp: Date.now() + index,
  content: [{ type: "text", key: String(index), text }],
});

test("connection loss uses one shared notice and keeps the chat and draft", async ({
  page,
}, info) => {
  await page.goto(url);
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(input).toBeVisible();
  await input.fill("断线时保留草稿");
  const original = page.url();
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await page.getByRole("tab", { name: "Work", exact: true }).click();
  await page.context().setOffline(true);
  const disconnected = once(worker, "message");
  worker.send("disconnect-clients");
  await disconnected;
  const notice = page.locator('.attention-toast[data-tone="info"]');
  await expect(notice).toHaveCount(1);
  await expect(notice).toContainText("与工作电脑的连接已中断");
  await expect(
    page
      .locator(".sidebar-empty[role=status]")
      .filter({ hasText: "正在连接…" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".detail-note").filter({ hasText: "连接中断" }),
  ).toHaveCount(0);
  await expect(input).toHaveText("断线时保留草稿");
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(notice).toHaveCSS(
      "background-color",
      theme === "dark" ? "rgb(20, 20, 22)" : "rgb(255, 255, 255)",
    );
    await expect(notice).toHaveCSS(
      "color",
      theme === "dark" ? "rgb(239, 239, 240)" : "rgb(32, 33, 35)",
    );
    await expect(notice.locator(".bot-avatar")).toHaveCount(0);
    await expect(notice.locator(".attention-symbol")).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`connection-notice-${theme}.png`),
      animations: "disabled",
    });
  }
  await page.context().setOffline(false);
  await expect(notice).toHaveCount(0);
  await expect(input).toHaveText("断线时保留草稿");
  expect(page.url()).toBe(original);
});

test("read failures use the branded warning and retry clears it", async ({
  page,
}, info) => {
  let fail = true;
  await page.route("**/rpc/chats/receipts", (route) =>
    fail
      ? route.fulfill({ status: 503, body: "Unavailable" })
      : route.continue(),
  );
  await seed({ records: [message(1, "等待确认已读的消息")] });
  await page.goto(url);
  const warning = page.locator(".attention-toast[data-error]");
  await expect(warning).toContainText("已读位置未能保存");
  await expect(page.locator(".sidebar .sidebar-empty[role=alert]")).toHaveCount(
    0,
  );
  fail = false;
  await warning.getByRole("button", { name: "重试", exact: true }).click();
  await expect(warning).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const errorText = "工作电脑无法保存当前设置。".repeat(12);
  await page.evaluate((message) => {
    window.dispatchEvent(
      new CustomEvent("domos:error", {
        detail: {
          id: "settings-save",
          message,
          label: "重试",
          action: () => {},
        },
      }),
    );
  }, errorText);
  await expect(warning).toContainText(errorText);
  const title = warning.locator(".attention-title");
  await expect(title).toHaveCSS("-webkit-line-clamp", "none");
  const aligned = await warning.evaluate((node) => {
    const title = node
      .querySelector(".attention-title")
      ?.getBoundingClientRect();
    const action = node
      .querySelector(".attention-action")
      ?.getBoundingClientRect();
    return Boolean(
      title &&
        action &&
        Math.abs(title.x - action.x) < 1 &&
        action.y >= title.bottom,
    );
  });
  expect(aligned).toBe(true);
  expect(
    await warning.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await expect(warning).toHaveCSS("opacity", "1");
  await expect(warning.locator(".attention-action")).toHaveCSS(
    "color",
    "rgb(32, 33, 35)",
  );
  await expect(warning.locator(".attention-close")).toHaveCSS(
    "color",
    "rgb(32, 33, 35)",
  );
  await expect(warning).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(warning.locator(".attention-symbol")).toHaveCSS(
    "color",
    "rgb(200, 50, 61)",
  );
  await page.screenshot({
    path: info.outputPath("error-notice-narrow.png"),
    animations: "disabled",
  });
});
test.beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "domos-attention-"));
  worker = fork(
    fileURLToPath(
      new URL("../../api/test/fixtures/web-server.ts", import.meta.url),
    ),
    [join(directory, "agent.sqlite"), "0", "native"],
    { silent: true, execArgv: [] },
  );
  worker.stderr?.resume();
  worker.stdout?.resume();
  const [ready] = await once(worker, "message");
  url = `http://127.0.0.1:${ready.port}`;
  rpc = createORPCClient(new RPCLink({ url: `${url}/rpc` }));
});
test.afterEach(async () => {
  if (worker.exitCode === null) {
    const done = once(worker, "exit");
    worker.kill("SIGKILL");
    await done;
  }
  await rm(directory, { recursive: true, force: true });
});

test("unread survives reload and search dialog loads results on scroll and bounded navigation", async ({
  page,
}, info) => {
  const bot = (await rpc.bots.list())[0];
  assert(bot);
  const peer = await rpc.bots.create({
    name: "Reviewer",
    requestId: crypto.randomUUID(),
  });
  const teamId = crypto.randomUUID();
  await rpc.teams.create({
    id: teamId,
    name: "发布小队",
    purpose: "审查发布",
    owner: bot.id,
    members: [bot.id, peer.id],
  });
  const teamSession = await rpc.teams.session({ id: teamId });
  await seed({
    sessionId: teamSession,
    records: [message(200, "团队发布已核对")],
  });
  await seed({
    records: Array.from({ length: 430 }, (_, index) => message(index)),
  });
  await page.goto(`${url}/#bot/${peer.id}`);
  const contact = page
    .locator(`.contact-row[href="#bot/${bot.id}"]`)
    .locator("..");
  await expect(contact.locator(".unread-badge")).toHaveText("99+");
  await expect(
    page.locator(`.contact-row[href="#team/${teamId}"] .unread-badge`),
  ).toHaveText("1");
  const handle = page.getByRole("separator", { name: "调整联系人宽度" });
  await handle.dblclick();
  await expect(page.locator(".workspace")).toHaveAttribute(
    "data-sidebar-compact",
    "true",
  );
  await expect(contact.locator(".unread-badge")).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "新建", exact: true }),
  ).toBeInViewport();
  await page.screenshot({ path: info.outputPath("unread-compact.png") });
  await page
    .getByRole("button", { name: "搜索联系人和聊天记录", exact: true })
    .click();
  const before = await contact.boundingBox();
  const search = page.getByRole("searchbox", { name: "搜索联系人和聊天记录" });
  let pageRequests = 0;
  await page.route("**/rpc/chats/search", async (route) => {
    if (
      route.request().postData()?.includes('"before"') &&
      ++pageRequests === 1
    )
      await route.abort("failed");
    else await route.continue();
  });
  await search.fill("查找报告");
  await expect(page.locator(".search-result")).toHaveCount(50);
  await page
    .locator(".chat-search-dialog .scroll-viewport")
    .evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
  await expect(
    page.locator(".chat-search-dialog .inline-notice"),
  ).toContainText("聊天记录搜索失败，请重试。");
  expect(pageRequests).toBe(1);
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator(".search-result")).toHaveCount(100);
  expect(pageRequests).toBe(2);
  const dialog = page.getByRole("dialog", { name: "搜索", exact: true });
  const headerBox = await dialog.locator(".dialog-subheader").boundingBox();
  const footerBox = await dialog.locator(".dialog-footer").boundingBox();
  await dialog.locator(".scroll-viewport").evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  expect(await dialog.locator(".dialog-subheader").boundingBox()).toEqual(
    headerBox,
  );
  expect(await dialog.locator(".dialog-footer").boundingBox()).toEqual(
    footerBox,
  );

  await page
    .locator(".chat-search-dialog .scroll-viewport")
    .evaluate((node) => {
      node.scrollTop = 0;
    });
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.screenshot({
      path: info.outputPath(`search-${theme}.png`),
      animations: "disabled",
    });
  }
  await page
    .locator(".chat-search-dialog .scroll-viewport")
    .evaluate((node) => {
      node.scrollTop = 0;
    });
  await search.fill("查找报告 0");
  await expect(page.locator(".search-result")).toHaveCount(1);
  let positioned = 0;
  page.on("request", (request) => {
    if (
      request.url().endsWith("/rpc/get") &&
      request.postData()?.includes('"around"')
    )
      positioned++;
  });
  await page.locator(".search-result").click();
  await expect(page.locator('[data-message-id="saved:0"]')).toBeInViewport();
  await expect(
    page.getByRole("dialog", { name: "搜索", exact: true }),
  ).toBeHidden();
  expect(positioned).toBe(1);
  await expect
    .poll(async () =>
      Number(
        (
          await contact.locator(".unread-badge").getAttribute("aria-label")
        )?.split(" ")[0],
      ),
    )
    .toBeLessThan(430);
  expect(
    Number(
      (
        await contact.locator(".unread-badge").getAttribute("aria-label")
      )?.split(" ")[0],
    ),
  ).toBeGreaterThan(0);
  const after = await contact.boundingBox();
  expect(after?.x).toBe(before?.x);
  await handle.dblclick();
  await page.locator(`.contact-row[href="#bot/${peer.id}"]`).click();
  await page.reload();
  await expect(contact.locator(".unread-badge")).toBeVisible();
  const count = Number(
    (await contact.locator(".unread-badge").getAttribute("aria-label"))?.split(
      " ",
    )[0],
  );
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThan(430);
  await page.screenshot({ path: info.outputPath("unread-persistent.png") });
});

test("attention identifies the assistant, opens its message and respects mute", async ({
  page,
}, info) => {
  const bot = (await rpc.bots.list())[0];
  assert(bot);
  const peer = await rpc.bots.create({
    name: "Reviewer",
    requestId: crypto.randomUUID(),
  });
  await page.goto(`${url}/#bot/${peer.id}`);
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeEnabled();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(localStorage).some(
          (key) =>
            key.startsWith("domos:attention:") &&
            JSON.parse(localStorage.getItem(key) ?? "{}").event === 0,
        ),
      ),
    )
    .toBe(true);
  await seed({
    records: [message(1, "报告已整理好，包含两项修改建议。")],
    run: {
      turnId: "turn:1",
      provider: "pi",
      model: null,
      startedAt: Date.now() - 1000,
      endedAt: Date.now(),
      status: "ended",
    },
  });
  await expect(page.locator(".attention-toast")).toHaveCount(1);
  await expect(page.locator(".attention-title")).toHaveText(bot.name);
  await expect(page.locator(".attention-toast")).toHaveCSS("opacity", "1");
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator(".attention-title")).toHaveCSS(
      "color",
      theme === "dark" ? "rgb(239, 239, 240)" : "rgb(32, 33, 35)",
    );
    await expect(page.locator(".attention-context")).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath(`attention-${theme}.png`),
      animations: "disabled",
    });
  }
  await page.locator(".attention-body").click();
  await expect(page).toHaveURL(new RegExp(`#bot/${bot.id}/${bot.id}$`));
  await expect(page.locator('[data-message-id="saved:1"]')).toBeInViewport();
  await page.getByRole("button", { name: "提醒设置", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "静音当前聊天", exact: true })
    .click();
  await page.locator(`.contact-row[href="#bot/${peer.id}"]`).click();
  await seed({
    records: [message(2)],
    run: {
      turnId: "turn:2",
      provider: "pi",
      model: null,
      startedAt: Date.now() - 1000,
      endedAt: Date.now(),
      status: "ended",
    },
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(localStorage)
            .filter((key) => key.startsWith("domos:attention:"))
            .map(
              (key) => JSON.parse(localStorage.getItem(key) ?? "{}").event,
            )[0],
      ),
    )
    .toBe(2);
  await expect(page.locator(".attention-toast")).toHaveCount(0);
  await expect(
    page
      .locator(`.contact-row[href="#bot/${bot.id}"]`)
      .locator("..")
      .locator(".unread-badge"),
  ).toBeVisible();
});

test("search dialog retries failures and discards an older query response", async ({
  page,
}) => {
  await seed({ records: [message(1, "报告甲"), message(2, "报告乙")] });
  await page.goto(url);
  let fail = true;
  let release: (() => void) | undefined;
  await page.route("**/rpc/chats/search", async (route) => {
    if (fail) {
      fail = false;
      await route.abort("failed");
    } else if (route.request().postData()?.includes("报告甲")) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.continue().catch(() => {});
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "搜索联系人和聊天记录", exact: true })
    .click();
  const search = page.getByRole("searchbox", { name: "搜索联系人和聊天记录" });
  await search.fill("报告");
  await expect(
    page.locator(".chat-search-dialog .inline-notice"),
  ).toContainText("聊天记录搜索失败，请重试。");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator(".search-result")).toHaveCount(2);
  await search.fill("报告甲");
  await expect.poll(() => Boolean(release)).toBe(true);
  await search.fill("报告乙");
  await expect(page.locator(".search-result")).toHaveCount(1);
  await expect(page.locator(".search-result")).toContainText("报告乙");
  release?.();
  await search.fill("");
  await expect(page.locator(".search-result")).toHaveCount(0);
  await expect(
    page
      .getByRole("dialog", { name: "搜索", exact: true })
      .locator(".search-hit")
      .first(),
  ).toBeVisible();
  await search.fill("报告乙");
  await page.evaluate(() => window.dispatchEvent(new Event("domos:computer")));
  await expect(search).toHaveValue("");
  await expect(page.locator(".search-result")).toHaveCount(0);
});

test("failure reminders open the corresponding Work record", async ({
  page,
}) => {
  const bot = (await rpc.bots.list())[0];
  assert(bot);
  const peer = await rpc.bots.create({
    name: "Reviewer",
    requestId: crypto.randomUUID(),
  });
  await page.goto(`${url}/#bot/${peer.id}`);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(localStorage).some(
          (key) =>
            key.startsWith("domos:attention:") &&
            JSON.parse(localStorage.getItem(key) ?? "{}").event === 0,
        ),
      ),
    )
    .toBe(true);
  await seed({
    records: [{ ...message(3, "整理失败的报告"), role: "user" }],
    run: {
      turnId: "turn:3",
      provider: "pi",
      model: null,
      status: "failed",
      startedAt: Date.now() - 1000,
      endedAt: Date.now(),
      error: "测试失败",
    },
  });
  await expect(page.locator(".attention-toast")).toContainText(
    "这项工作未能完成",
  );
  await page.locator(".attention-body").click();
  await expect(page).toHaveURL(new RegExp(`#bot/${bot.id}/${bot.id}$`));
  const record = page.getByRole("dialog", { name: "工作记录", exact: true });
  await expect(record).toBeVisible();
  await expect(record).toContainText("整理失败的报告");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("tab", { name: "Work", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});
