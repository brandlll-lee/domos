import { once } from "node:events";
import { characterIdentity } from "@domos/ui/characters";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { expect } from "@playwright/test";
import type { AppRouter } from "../../api/src/router.ts";
import {
  chooseAppearance,
  createBot,
  expectTextContrast,
  openDetails,
} from "./fixtures/chat-ui.ts";
import { test } from "./fixtures/service.ts";

test("message actions share the bubble row and retain layout through hover and keyboard use", async ({
  service,
  page,
}, info) => {
  test.setTimeout(60_000);
  await service.control({
    records: ["user", "assistant"].map((role, index) => ({
      id: `actions:${role}`,
      role,
      stopped: false,
      timestamp: Date.now() + index,
      content: [
        {
          type: "text",
          key: `text:${role}`,
          text: "核对布局与消息操作。".repeat(25),
        },
      ],
    })),
  });
  await page.goto(service.url);
  await page
    .locator("#bot-details")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  for (const appearance of ["浅色", "深色"]) {
    await page.setViewportSize({ width: 1360, height: 900 });
    await chooseAppearance(page, appearance);
    for (const width of [1360, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const role of ["user", "assistant"]) {
        const message = page.locator(`.message.${role}`);
        const bubble = message.locator(".message-bubble");
        const action = message.getByRole("button", { name: "消息操作" });
        await bubble.scrollIntoViewIfNeeded();
        await page.mouse.move(width - 2, 2);
        await page.getByLabel("消息", { exact: true }).focus();
        await expect(action).toHaveCSS("opacity", "0");
        const before = await bubble.boundingBox();
        const button = await action.boundingBox();
        expect(before).not.toBeNull();
        expect(button).not.toBeNull();
        if (!before || !button) throw new Error("Message bounds required");
        expect(button.y).toBeGreaterThanOrEqual(before.y);
        expect(button.y + button.height).toBeLessThanOrEqual(
          before.y + before.height + 0.5,
        );
        if (role === "assistant")
          expect(button.x).toBeGreaterThanOrEqual(before.x + before.width);
        else expect(button.x + button.width).toBeLessThanOrEqual(before.x);
        const row = await message.boundingBox();
        expect(row?.height).toBeCloseTo(before.height, 0);
        await bubble.hover();
        await expect(action).toHaveCSS("opacity", "1");
        expect(await bubble.boundingBox()).toEqual(before);
        await action.hover();
        await expect(action).toHaveCSS("opacity", "1");
        await action.click();
        const reference = page.getByRole("menuitem", {
          name: "引用消息",
          exact: true,
        });
        await reference.hover();
        await expect(reference).toBeVisible();
        await expect(action).toHaveCSS("opacity", "1");
        expect(await bubble.boundingBox()).toEqual(before);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect(action).toBeFocused();
        await expect(action).toHaveCSS("opacity", "1");
        await action.press("Enter");
        await expect(reference).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect(action).toBeFocused();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        await expect(action).toBeFocused();
        await expect(action).toHaveCSS("opacity", "1");
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`message-actions-${appearance}-${width}.png`),
        animations: "disabled",
      });
    }
  }
});

test.describe("touch message actions", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("touch exposes actions and messages with no actions keep their content", async ({
    service,
    page,
  }) => {
    await service.control({
      records: [
        ...["user", "assistant"].map((role) => ({
          id: `touch:${role}`,
          role,
          stopped: false,
          content: [{ type: "text", key: role, text: "触屏消息操作" }],
        })),
        {
          id: "touch:notice",
          role: "toolResult",
          stopped: false,
          content: [],
          notice: { text: "资料已交付" },
        },
      ],
    });
    await page.goto(service.url);
    for (const role of ["user", "assistant"]) {
      const message = page.locator(`[data-message-id="touch:${role}"]`);
      const action = message.getByRole("button", { name: "消息操作" });
      await expect(action).toHaveCSS("opacity", "1");
      await action.tap();
      await page.getByRole("menuitem", { name: "引用消息", exact: true }).tap();
      await expect(
        page
          .getByLabel("消息", { exact: true })
          .locator("[data-inline-token]")
          .last(),
      ).toContainText("触屏消息操作");
    }
    const notice = page.locator('[data-message-id="touch:notice"]');
    await expect(notice).toHaveText("资料已交付");
    await expect(notice.getByRole("button", { name: "消息操作" })).toHaveCount(
      0,
    );
  });
});

test("send, reload, disconnect, reconnect and restart preserve the conversation", async ({
  service,
  page,
}) => {
  await page.goto(service.url);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  await page.screenshot({ path: "test-results/chat-desktop.png" });
  await service.control("gate");
  await page.getByLabel("消息", { exact: true }).fill("记住这句话");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("你的消息")).toContainText("记住这句话");
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(0);
  await page.goto("about:blank");
  await service.control("release");
  await page.goto(service.url);
  await expect(page.getByLabel("Domos 的回复")).toContainText("完整回复。");
  await expect(
    page.getByRole("button", { name: "语音输入（暂未开放）", exact: true }),
  ).toBeVisible();
  const contactTime = page.locator(
    '.conversation-row[aria-current="page"] time',
  );
  await expect(contactTime).toHaveText(/^\d{2}:\d{2}$/);
  const lastMessage = (
    await createORPCClient<RouterClient<AppRouter>>(
      new RPCLink({ url: `${service.url}/rpc` }),
    ).get({ botId: 1 })
  ).messages.at(-1);
  await expect(contactTime).toHaveAttribute(
    "datetime",
    new Date(lastMessage?.timestamp ?? 0).toISOString(),
  );
  const savedTime = await contactTime.getAttribute("datetime");
  await page.screenshot({ path: "test-results/chat-conversation.png" });
  const port = Number(new URL(service.url).port);
  await service.stop();
  await service.start(port);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("Domos 的回复")).toContainText("记住这句话");
  await expect(page.getByLabel("你的消息")).toHaveCount(1);
  await expect(contactTime).toHaveAttribute("datetime", savedTime ?? "");
});

test("a killed server retains uncertain work and permits an explicit retry", async ({
  service,
  page,
}) => {
  await page.goto(service.url);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  await service.control("gate");
  await page.getByLabel("消息", { exact: true }).fill("恢复未完成任务");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  const contact = page.locator(".sidebar .bot-menu-trigger").first();
  await expect(contact.getByRole("status", { name: "正在工作" })).toBeVisible();
  await service.control("wait-model");
  const port = Number(new URL(service.url).port);
  await service.stop();
  await expect(contact.locator(".loading-dots")).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "正在重连" }),
  ).toBeAttached();
  await service.start(port);
  await expect(
    page.getByRole("log", { name: "聊天记录" }).getByRole("alert"),
  ).toContainText("执行结果未确认");
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(0);
  await expect(page.getByLabel("你的消息")).toHaveCount(1);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  await expect(contact.locator(".loading-dots")).toHaveCount(0);
  await page.getByLabel("消息", { exact: true }).fill("重试恢复未完成任务");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByLabel("Domos 的回复")).toContainText("完整回复。");
  await expect(page.getByLabel("你的消息")).toHaveCount(2);
});

test("a reply arrives complete while typing survives reloads", async ({
  service,
  page,
}) => {
  const answer = "完整回答。资料已经核对，以下内容一次交付。".repeat(8);
  await service.control("gate-tool");
  await service.control({
    responses: [
      {
        stopReason: "toolUse",
        content: [
          {
            type: "toolCall",
            id: crypto.randomUUID(),
            name: service.toolName,
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
  await page.goto(service.url);
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
  await service.control("release");
  await expect(page.getByLabel("Domos 的回复")).toHaveText(answer);
  const frames = await page.evaluate(
    () => (window as unknown as { replyFrames: string[] }).replyFrames,
  );
  expect(frames.length).toBeGreaterThan(0);
  expect(new Set(frames)).toEqual(new Set([answer]));
  await expect(typing).toHaveCount(0);
  const port = Number(new URL(service.url).port);
  await service.stop();
  await service.start(port);
  await page.reload();
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(1);
  await expect(page.getByLabel("Domos 的回复")).toHaveText(answer);
});

test("stopping preserves the conversation and resending uses the message menu", async ({
  service,
  page,
}) => {
  await service.control({ content: "这份尚未生成完毕的回答。".repeat(30) });
  await page.goto(service.url);
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
  await page.getByLabel("你的消息").hover();
  await page
    .getByLabel("你的消息")
    .getByRole("button", { name: "消息操作" })
    .click();
  await page.getByRole("menuitem", { name: "重新发送", exact: true }).click();
  await expect(page.getByLabel("消息", { exact: true })).toHaveText(
    "停止这次回答",
  );
});

test("stop and Chinese input work on a narrow screen", async ({
  service,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(service.url);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  await service.control("gate");
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
    page.getByRole("button", { name: "语音输入（暂未开放）", exact: true }),
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
  service,
  page,
}) => {
  await page.goto(service.url);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  await page.route("**/rpc/send", async (route) => {
    await route.fetch();
    await route.abort();
    await page.unroute("**/rpc/send");
  });
  await page.getByLabel("消息", { exact: true }).fill("同一条请求");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const warning = page.getByRole("alert").filter({ hasText: "发送未确认" });
  await expect(warning).toBeVisible();
  await expect(page.getByLabel("Domos 的回复")).toContainText("完整回复。");
  await page.reload();
  await expect(warning).toBeVisible();
  await page.getByRole("button", { name: "重试发送", exact: true }).click();
  await expect(page.getByLabel("消息", { exact: true })).toHaveText("");
  await expect(page.getByLabel("你的消息")).toHaveCount(1);
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(1);
});

test("two windows can submit while a reply is active", async ({
  service,
  page,
  browser,
}) => {
  await page.goto(service.url);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  const other = await browser.newPage();
  await other.goto(service.url);
  await expect(other.getByLabel("消息", { exact: true })).toBeEnabled();
  await service.control("gate");
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
  await service.control("release");
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
    page.getByRole("button", { name: "语音输入（暂未开放）", exact: true }),
  ).toBeVisible();
  await other.close();
});

test("typing follows the Bot and failures retain their error message", async ({
  service,
  page,
}, testInfo) => {
  await page.goto(service.url);
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
  await service.control("gate-tool");
  await service.control(call("stopped.md"));
  await input.fill("生成文件");
  await send.click();
  await page.getByRole("button", { name: "批准", exact: true }).click();
  await expect(page.locator(".typing-dots")).toBeVisible();
  await createBot(page, "旁观助手");
  await expect(page.locator(".typing-dots")).toHaveCount(0);
  await page.getByRole("link", { name: "Domos", exact: true }).click();
  await expect(page.locator(".typing-dots")).toBeVisible();
  const stoppedReceipt = page.waitForResponse("**/rpc/stop");
  await page.getByRole("button", { name: "停止生成", exact: true }).click();
  await stoppedReceipt;
  await expect(page.locator(".typing-dots")).toHaveCount(0);
  await expect(page.locator('.task-notice[data-state="stopped"]')).toHaveCount(
    0,
  );
  await service.control({
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
  await service.control({ responses: [{ content: "", stopReason: "error" }] });
  await input.fill("再次生成");
  await send.click();
  await expect(failure).toHaveCount(1);
  await expect(failure).toContainText("回复失败，原因待确认");
  await expect(failure).toContainText(/〔\d+:\d+〕/);
  await expect(failure.getByRole("alert")).toBeVisible();
  await failure
    .getByRole("button", { name: "查看工作记录", exact: true })
    .click();
  const workRecord = page.getByRole("dialog", {
    name: "工作记录",
    exact: true,
  });
  await expect(workRecord).toBeVisible();
  await expect(workRecord).toContainText("回复失败，原因待确认");
  await page.keyboard.press("Escape");
  await expect(workRecord).not.toBeVisible();
  await failure
    .getByRole("button", { name: "查看工作记录", exact: true })
    .click();
  await expect(workRecord).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(failure.locator('svg[aria-hidden="true"]')).toHaveCount(1);
  const errorText = await failure.getByRole("alert").innerText();
  const port = Number(new URL(service.url).port);
  await service.stop();
  await service.start(port);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "语音输入（暂未开放）", exact: true }),
  ).toBeVisible();
  await expect(failure).toHaveCount(1);
  await expect(failure.getByRole("alert")).toHaveText(errorText);
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
  await page.getByLabel("你的消息").last().hover();
  await page
    .getByLabel("你的消息")
    .last()
    .getByRole("button", { name: "消息操作" })
    .click();
  await page.getByRole("menuitem", { name: "重新发送", exact: true }).click();
  await expect(input).toHaveText("再次生成");
});

test("chat keeps sending available while the Bot is working", async ({
  service,
  page,
}) => {
  await service.control("gate-tool");
  await service.control({
    responses: [
      {
        stopReason: "toolUse",
        content: [
          { type: "text", text: "Checking sources" },
          {
            type: "toolCall",
            id: crypto.randomUUID(),
            name: service.toolName,
            arguments: { text: "Waiting" },
          },
        ],
      },
      { content: "All requests received" },
    ],
  });
  await page.goto(service.url);
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
  await service.control("release");
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
  service,
  page,
}) => {
  await service.control("gate-tool");
  await service.control({
    responses: [
      {
        stopReason: "toolUse",
        content: [
          {
            type: "toolCall",
            id: crypto.randomUUID(),
            name: service.toolName,
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
            name: service.toolName,
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
  await page.goto(service.url);
  const input = page.getByLabel("消息", { exact: true });
  await input.fill("核对资料");
  await input.press("Enter");
  const typing = page.locator(".typing-row");
  await expect(typing).toBeVisible();
  await service.control("wait-tool");
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
  await service.control("release");
  await service.control("gate-tool");
  await expect(page.getByLabel("Domos 的回复")).toHaveText("正在核对资料。");
  await page.evaluate(() => document.activeViewTransition?.finished);
  const after = await typing.boundingBox();
  if (!after) throw new Error("Typing bubble required");
  expect(after.y).toBeGreaterThan(before.y);
  await service.control("release");
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
  service,
  page,
}) => {
  await service.control("gate-tool");
  await service.control({
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
            name: service.toolName,
            arguments: { text: "已核对完整资料。" },
          },
        ],
      },
      { content: "**整理完成。**\n\n资料已核对，可以继续修改。" },
    ],
  });
  await page.goto(service.url);
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
  const typingBubble = page.locator(".typing-row > .message-bubble");
  await expect(typingBubble).toBeVisible();
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
    "loading-wave",
    "loading-wave",
    "loading-wave",
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
  await page.locator(".bot-avatar").evaluateAll(async (elements) => {
    const snapshot = () =>
      elements.map((element) => element.outerHTML).join("");
    let previous = snapshot();
    for (let stable = 0; stable < 3; ) {
      await new Promise(requestAnimationFrame);
      const current = snapshot();
      stable = current === previous ? stable + 1 : 0;
      previous = current;
    }
  });
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
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const idleBefore = await performance.send("Performance.getMetrics");
  const idleIntervals = await sampleFrames();
  const idleAfter = await performance.send("Performance.getMetrics");
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
  const idleMs =
    (metric(idleAfter, "LayoutDuration") -
      metric(idleBefore, "LayoutDuration") +
      metric(idleAfter, "RecalcStyleDuration") -
      metric(idleBefore, "RecalcStyleDuration")) *
    1000;
  const animationMsPerFrame =
    (layoutMs + styleMs) / intervals.length - idleMs / idleIntervals.length;
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
      idleMs,
      animationMsPerFrame,
      intervals,
      idleIntervals,
    }),
    contentType: "application/json",
  });
  await surroundingAnimations.evaluate((animations) => {
    for (const animation of animations) animation.play();
  });
  await surroundingAnimations.dispose();
  expect(animationMsPerFrame).toBeLessThan(1);
  for (const [theme, label] of [
    ["dark", "深色"],
    ["light", "浅色"],
  ] as const) {
    await chooseAppearance(page, label);
    await expect(typing).toBeVisible();
    const textHeight = await replies
      .locator(".message-bubble")
      .evaluate((node) => node.getBoundingClientRect().height);
    await expect(typingBubble).toHaveCSS("height", `${textHeight}px`);
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
  await service.control("release");
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

test("sending paints the outgoing message and waiting feedback before the network receipt", async ({
  service,
  page,
}) => {
  await page.goto(service.url);
  const seeded = once(service.worker, "message");
  service.worker.send({ history: 160 });
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
    await expect(page.locator(".typing-dots")).toBeVisible();
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

test("returning to a Bot shows retained messages and draft while its stream is delayed", async ({
  service,
  page,
}, info) => {
  const receipt = once(service.worker, "message");
  service.worker.send({ history: 60 });
  await receipt;
  await page.goto(service.url);
  await expect(page.getByLabel("你的消息").last()).toContainText("历史任务 60");
  await page.getByLabel("消息", { exact: true }).fill("甲的草稿");
  const transcript = page.locator(".transcript");
  await transcript.evaluate((element) => {
    element.scrollTop = element.scrollHeight / 2;
  });
  const top = await transcript.evaluate((element) => element.scrollTop);
  await expect
    .poll(() => transcript.evaluate((element) => element.scrollTop))
    .toBe(top);
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page.getByRole("menuitem", { name: "新建 Bot", exact: true }).click();
  const create = page.getByRole("dialog", { name: "新建 Bot", exact: true });
  await create.getByRole("textbox", { name: "名字", exact: true }).fill("乙");
  await create.getByRole("button", { name: "创建", exact: true }).click();
  await create.getByRole("button", { name: "Pi", exact: true }).click();
  await create.getByRole("combobox", { name: "模型", exact: true }).click();
  await page
    .getByRole("option", { name: "Pi · 测试模型一", exact: true })
    .click();
  await create.getByRole("button", { name: "开始聊天", exact: true }).click();
  await expect(create).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Bot详情", exact: true }),
  ).toContainText("乙");
  const gate = Promise.withResolvers<void>();
  let waiting = false;
  await page.route("**/rpc/changes", async (route) => {
    waiting = true;
    await gate.promise;
    await route.continue();
  });
  try {
    const started = Date.now();
    await page.locator(".contact-row").filter({ hasText: "Domos" }).click();
    await expect.poll(() => waiting).toBe(true);
    await expect(page.getByLabel("你的消息").last()).toContainText(
      "历史任务 60",
    );
    await expect(page.getByText("正在加载对话…", { exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByLabel("消息", { exact: true })).toHaveText(
      "甲的草稿",
    );
    await expect
      .poll(() => transcript.evaluate((element) => element.scrollTop))
      .toBe(top);
    await info.attach("cached-return", {
      body: JSON.stringify({
        elapsedMs: Date.now() - started,
        freshSnapshotBlocked: waiting,
        scrollTop: top,
      }),
      contentType: "application/json",
    });
  } finally {
    gate.resolve();
  }
});
