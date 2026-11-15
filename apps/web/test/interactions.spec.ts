import { once } from "node:events";
import { readFile } from "node:fs/promises";
import type { Attachment } from "@domos/agent/attachments";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { expect } from "@playwright/test";
import type { AppRouter } from "../../api/src/router.ts";
import { chooseAppearance } from "./fixtures/chat-ui.ts";
import { test } from "./fixtures/service.ts";

test("native questions use the shared card and native replies persist", async ({
  service,
  page,
}) => {
  await service.control({
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
  await page.goto(service.url);
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
  await choice.getByRole("button", { name: "简短", exact: true }).click();
  await expect(choice).toHaveAttribute("data-state", "answered");
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
    page.getByRole("button", { name: "语音输入（暂未开放）", exact: true }),
  ).toBeVisible();
  const port = Number(new URL(service.url).port);
  await service.stop();
  await service.start(port);
  await page.reload();
  await expect(replies).toHaveText(["正在核对资料。", "已按你的选择完成。"]);
  await expect(choice).toHaveAttribute("data-state", "answered");
  await expect(choice.locator(".question-reply")).toHaveCount(2);
  await expect(choice.locator(".question-reply[data-selected]")).toHaveText(
    "简短",
  );
  await expect(choice.locator(".question-reply[data-selected]")).toHaveCSS(
    "opacity",
    "1",
  );
  await service.control({
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
    page.getByRole("button", { name: "语音输入（暂未开放）", exact: true }),
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
  await service.control({
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
  await expect(stopped).toHaveAttribute("data-state", "pending");
  await expect(
    stopped.getByRole("textbox", { name: "你的回答", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await expect(stopped).toHaveAttribute("data-state", "pending");
  await expect(
    stopped.getByRole("textbox", { name: "你的回答", exact: true }),
  ).toBeEnabled();
});

test("action drafts edit the confirmed version and keep previews across themes and reload", async ({
  service,
  page,
}, testInfo) => {
  service.worker.send({
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
  await page.goto(service.url);
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
  service,
  page,
}, testInfo) => {
  const rpc: RouterClient<AppRouter> = createORPCClient(
    new RPCLink({ url: `${service.url}/rpc` }),
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
  service.worker.send({ approval: request });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto(service.url);
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
  const answered = once(service.worker, "message");
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
  service.worker.send({ approval: { ...request, id: "credential-cancel" } });
  const pending = page.locator('.action-card[data-state="pending"]');
  await expect(pending).toBeVisible();
  const cancelled = once(service.worker, "message");
  await pending.getByRole("button", { name: "取消", exact: true }).click();
  expect(JSON.stringify(await cancelled)).toContain('"allow":false');
  await expect(pending).toHaveCount(0);
});

test("shared question and approval cards persist answers and terminal states", async ({
  service,
  page,
}, info) => {
  await page.goto(service.url);
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
    service.worker.send({
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
    if (mode === "custom") {
      expect((await card.boundingBox())?.height).toBeLessThan(300);
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await card.screenshot({
          path: info.outputPath(`question-text-${colorScheme}.png`),
          animations: "disabled",
        });
      }
    }
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
        service.worker.off("message", receive);
        resolve(value);
      };
      service.worker.on("message", receive);
    });
    if (mode === "custom") {
      await card.getByRole("button", { name: "自己填写", exact: true }).click();
      await expect(
        card.getByRole("button", { name: "发送回答", exact: true }),
      ).toBeDisabled();
      await card
        .getByRole("textbox", { name: "你的回答", exact: true })
        .fill("我自己选择");
      await card.getByRole("button", { name: "发送回答", exact: true }).click();
    } else if (mode === "multiple") {
      await card.getByRole("button", { name: "自己填写", exact: true }).click();
      await card
        .getByRole("textbox", { name: "你的回答", exact: true })
        .fill("附加建议");
      await card.getByRole("button", { name: "第一项", exact: true }).click();
      await card.getByRole("button", { name: "第二项", exact: true }).click();
      await expect(
        card.getByRole("textbox", { name: "你的回答", exact: true }),
      ).toHaveValue("附加建议");
      await expect(card).toHaveAttribute("data-state", "pending");
      await card.getByRole("button", { name: "发送回答", exact: true }).click();
    } else if (mode === "expire") service.worker.send("release");
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
      expect(result.answer.answers).toEqual({ q: ["附加建议", "a", "b"] });
    const expected =
      mode === "expire"
        ? "已失效"
        : mode === "deny"
          ? "已拒绝"
          : mode === "approve"
            ? "已批准"
            : "已回答";
    if (mode === "custom" || mode === "multiple") {
      await expect(card).toHaveAttribute("data-state", "answered");
      await expect(card.locator(".question-reply")).toHaveCount(2);
      await page.reload();
      await expect(card).toHaveAttribute("data-state", "answered");
      continue;
    }
    await expect(card.getByRole("status")).toHaveText(expected);
    await expect(card.locator(".interaction-card")).toHaveCount(0);
    await card.getByRole("button").click();
    const recordDialog = page.getByRole("dialog", { name: title, exact: true });
    await expect(recordDialog).toBeVisible();
    if (mode === "approve") {
      await recordDialog.getByText("技术详情", { exact: true }).click();
      await expect(recordDialog).toContainText("测试操作参数");
    }
    await page.keyboard.press("Escape");
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

test("question replies align and completed questions remain readable", async ({
  service,
  page,
}, info) => {
  service.worker.send({
    approval: {
      id: "reading-question",
      kind: "question",
      title: "一起了解你的性格倾向",
      detail: "先从一个日常场景开始。没有标准答案。",
      questions: [
        {
          id: "day",
          title: "忙碌一周后，你更想怎么过？",
          options: [
            {
              id: "friends",
              label: "找朋友见面或出去玩",
              description: "和人在一起会让我更有精神。",
            },
            {
              id: "alone",
              label: "自己待着，做喜欢的事",
              description: "独处会让我恢复精力。",
            },
            {
              id: "both",
              label: "两种都喜欢",
              description: "主要看心情和跟谁在一起。",
            },
          ],
        },
      ],
    },
  });
  await page.goto(service.url);
  const card = page.getByRole("region", {
    name: "一起了解你的性格倾向",
    exact: true,
  });
  await expect(card).toBeVisible();
  const details = page.getByRole("complementary", { name: /的详情$/ });
  if (await details.isVisible())
    await details.getByRole("button", { name: "关闭", exact: true }).click();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [1360, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const rows = await card
        .locator(".question-reply")
        .evaluateAll((elements) =>
          elements.map((el) => {
            const border = getComputedStyle(el).borderStyle;
            const copy = el
              .querySelector(".question-reply-copy")
              ?.getBoundingClientRect();
            return {
              border,
              copy: copy?.left,
              align: getComputedStyle(el).textAlign,
            };
          }),
        );
      expect(rows.every((row) => row.border === "dashed")).toBe(true);
      expect(new Set(rows.map((row) => row.copy)).size).toBe(1);
      expect(rows.every((row) => row.align === "left")).toBe(true);
      const option = card.getByRole("button", { name: /自己待着/ });
      await page.mouse.move(1, 1);
      const resting = await option.boundingBox();
      await option.hover();
      await expect(option).toHaveCSS("border-style", "dashed");
      await expect(option).not.toHaveCSS(
        "background-color",
        "rgba(0, 0, 0, 0)",
      );
      expect(await option.boundingBox()).toEqual(resting);
      await page.mouse.move(1, 1);
      await page.screenshot({
        path: info.outputPath(`question-aligned-${colorScheme}-${width}.png`),
      });
    }
  }
  await card.getByRole("button", { name: /自己待着/ }).click();
  await expect(card).toHaveAttribute("data-state", "answered");
  await expect(card.locator(".question-reply")).toHaveCount(3);
  await expect(card.locator(".question-reply[data-selected]")).toHaveCSS(
    "border-style",
    "dashed",
  );
  await expect(card.locator(".question-reply[data-selected]")).toContainText(
    "自己待着",
  );
  await expect(
    card.getByRole("button", { name: "查看完整问题", exact: true }),
  ).toHaveCount(0);
  const quote = page.getByRole("button", { name: /回复.*忙碌一周后/ });
  await expect(quote).toBeVisible();
  await quote.click();
  await expect(card).toBeInViewport();
  await page.reload();
  await expect(card.locator(".question-reply[data-selected]")).toContainText(
    "自己待着",
  );
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const distance = await quote.evaluate((element) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas required");
      const pixel = (color: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
      };
      const bubble = element.closest(".message-bubble");
      if (!bubble) throw new Error("Reply bubble required");
      const background = pixel(getComputedStyle(bubble).backgroundColor);
      const quote = pixel(getComputedStyle(element).backgroundColor);
      return Math.max(
        ...background.map((channel, index) =>
          Math.abs(channel - (quote[index] ?? 0)),
        ),
      );
    });
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThan(20);
    await page.screenshot({
      path: info.outputPath(`question-readable-${colorScheme}.png`),
    });
  }
});

test("link cards show custom actions, lazy previews and stable history", async ({
  service,
  page,
}, info) => {
  const botId = (
    await (await page.request.post(`${service.url}/rpc/bots/list`)).json()
  ).json[0].id;
  const snapshot = (
    await (
      await page.request.post(`${service.url}/rpc/get`, {
        data: { json: { botId } },
      })
    ).json()
  ).json;
  const time = Date.now();
  const links = Array.from({ length: 10 }, (_, index) => ({
    id: `cta-${index}`,
    cursor: `${index + 100}:0`,
    role: "assistant",
    timestamp: time + index,
    stopped: false,
    content: [],
    link: {
      url: `https://example.com/${index}`,
      label: ["查看完整报告", "打开在线演示", "选择预约时间"][index % 3],
      body: "内容已整理好，你可以按需查看。",
      ...(index === 0
        ? { title: "本周报告", footer: "包含最新检查结果。" }
        : {}),
    },
  }));
  const initial = { ...snapshot, messages: links, busy: false };
  await page.route("**/rpc/get", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ json: initial }),
    }),
  );
  await page.addInitScript((initial) => {
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const input = args[0];
      const address = input instanceof Request ? input.url : String(input);
      if (!address.endsWith("/rpc/changes")) return original(...args);
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `event: message\ndata: ${JSON.stringify({ json: { type: "snapshot", view: initial } })}\n\n`,
              ),
            );
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    };
  }, initial);
  const cover = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#b6d9c8"/><text x="52" y="190" font-size="42" fill="#28644e">Domos · Report</text></svg>').toString("base64")}`;
  let reads = 0;
  let failedReads = 0;
  let releaseCover = () => {};
  const coverReady = new Promise<void>((resolve) => {
    releaseCover = resolve;
  });
  await page.route("**/rpc/files/linkPreview", async (route) => {
    reads++;
    const requested = route.request().postDataJSON().json.url;
    if (requested.endsWith("/0")) await coverReady;
    if (requested.endsWith("/2")) {
      failedReads++;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          json: { status: "failed", error: "暂时无法读取网页预览。" },
        }),
      });
      return;
    }
    if (requested.endsWith("/3") || requested.endsWith("/4")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          json: requested.endsWith("/3")
            ? { status: "blocked", error: "预览地址被安全规则拦截。" }
            : {
                status: "ready",
                thumbnail: "data:image/png;base64,aW52YWxpZA==",
              },
        }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        json: requested.endsWith("/0")
          ? { status: "ready", title: "Website fallback", thumbnail: cover }
          : { status: "empty", title: "在线演示" },
      }),
    });
  });
  let opened = 0;
  await page.route("https://example.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>Requested destination</title>Opened",
    }),
  );
  page.on("popup", () => opened++);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(service.url);
  const card = page.locator('[data-message-id="cta-0"] .link-card');
  await expect.poll(() => reads).toBeGreaterThan(0);
  expect(reads).toBeLessThan(links.length);
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible();
  await expect(card.locator(".link-card-cover > svg")).toBeVisible();
  await expect(card.locator(".link-card-cover > img")).toHaveCount(0);
  const coverHeight =
    (await card.locator(".link-card-cover").boundingBox())?.height ?? 0;
  const readingTop = (await card.boundingBox())?.y ?? 0;
  releaseCover();
  await expect(card.locator(".link-card-cover > img")).toHaveAttribute(
    "data-loaded",
    "true",
  );
  expect(
    Math.abs(
      ((await card.locator(".link-card-cover").boundingBox())?.height ?? 0) -
        coverHeight,
    ),
  ).toBeLessThan(1);
  await expect
    .poll(async () =>
      Math.abs(((await card.boundingBox())?.y ?? 0) - readingTop),
    )
    .toBeLessThan(2);
  await expect(page.locator(".link-card")).toHaveCount(links.length);
  await expect(card.getByText("本周报告", { exact: true })).toBeVisible();
  await expect(card.getByText("Website fallback", { exact: true })).toHaveCount(
    0,
  );
  expect(
    await card.evaluate((el) => el.closest(".message-bubble") !== null),
  ).toBe(false);
  expect(await card.locator(".link-card-action > svg").count()).toBe(1);
  await expect(
    page.locator('[data-message-id="cta-1"] .link-card-cover'),
  ).toBeVisible();
  await expect(
    page.locator('[data-message-id="cta-2"] .link-card-action'),
  ).toHaveText("选择预约时间");
  expect(opened).toBe(0);
  const failed = page.locator('[data-message-id="cta-2"] .link-card');
  await failed.scrollIntoViewIfNeeded();
  await expect(failed.locator(".link-card-cover")).toBeVisible();
  await expect.poll(() => failedReads).toBe(1);
  for (const index of [2, 3, 4]) {
    const fallback = page.locator(
      `[data-message-id="cta-${index}"] .link-card`,
    );
    await fallback.scrollIntoViewIfNeeded();
    await expect(fallback.locator(".link-card-cover > svg")).toBeVisible();
    await expect(fallback.getByRole("button")).toHaveCount(0);
    await expect(fallback.getByText(/无法读取|安全规则/)).toHaveCount(0);
    await expect(
      fallback.locator(".link-card-cover > img[data-loaded]"),
    ).toHaveCount(0);
    if (index === 4)
      await expect
        .poll(() =>
          fallback
            .locator("img")
            .evaluate((image: HTMLImageElement) => image.complete),
        )
        .toBe(true);
  }
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [1360, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const inspector = page.getByRole("complementary", { name: /的详情$/ });
      if (width === 390 && (await inspector.isVisible()))
        await inspector
          .getByRole("button", { name: "关闭", exact: true })
          .click();
      await card.scrollIntoViewIfNeeded();
      expect(
        await card.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`link-card-${colorScheme}-${width}.png`),
      });
    }
  }
  await card.locator(".link-card-action").focus();
  const popup = page.waitForEvent("popup");
  await page.keyboard.press("Enter");
  const destination = await popup;
  await expect(destination).toHaveURL("https://example.com/0");
  await destination.close();
  expect(opened).toBe(1);
  const before = reads;
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.reload();
  await expect(page.locator(".link-card")).toHaveCount(links.length);
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator(".link-card-cover > img")).toHaveAttribute(
    "data-loaded",
    "true",
  );
  expect(
    await page
      .locator("[data-message-id]")
      .evaluateAll((elements) =>
        elements.map((el) => el.getAttribute("data-message-id")),
      ),
  ).toEqual(links.map((link) => link.id));
  expect(reads).toBeGreaterThan(before);
  expect(opened).toBe(1);
});

test("candidate grids show every option and adapt to their available width", async ({
  service,
  page,
}) => {
  for (const count of [1, 2, 3, 4]) {
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.goto(service.url);
    const title = `比较 ${count} 个方案`;
    service.worker.send({
      approval: {
        id: `grid-${count}`,
        kind: "question",
        title,
        detail: "",
        questions: [
          {
            id: "q",
            title,
            options: Array.from({ length: count }, (_, index) => ({
              id: `option-${index}`,
              label: `方案 ${index + 1}`,
              actions: [{ id: `choose-${index}`, label: "选择这一项" }],
            })),
          },
        ],
      },
    });
    const card = page.getByRole("region", { name: title, exact: true });
    await expect(card.locator(".question-candidate")).toHaveCount(count);
    for (const width of [1360, 390]) {
      await page.setViewportSize({ width, height: 900 });
      if (width === 390) {
        const inspector = page.getByRole("complementary", { name: /的详情$/ });
        if (await inspector.isVisible())
          await inspector
            .getByRole("button", { name: "关闭", exact: true })
            .click();
      }
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await expect
          .poll(() =>
            card.locator(".question-candidates").evaluate(
              (element) =>
                getComputedStyle(element)
                  .gridTemplateColumns.split(" ")
                  .filter((width) => Number.parseFloat(width) > 0).length,
            ),
          )
          .toBe(width === 390 ? 1 : Math.min(2, count));
        expect(
          await card
            .locator(".question-candidates")
            .evaluate(
              (element) => element.scrollWidth <= element.clientWidth + 1,
            ),
        ).toBe(true);
      }
    }
    await card.getByRole("button", { name: "取消", exact: true }).click();
    await expect(card.getByRole("status")).toHaveText("已取消");
  }
});

test("rich questions keep media separate from replies and restore selected actions", async ({
  service,
  page,
}, info) => {
  test.setTimeout(60_000);
  await page.goto(service.url);
  const botId = (
    await (await page.request.post(`${service.url}/rpc/bots/list`)).json()
  ).json[0].id;
  const image = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 600;
      canvas.height = 320;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas required");
      context.fillStyle = "#b6d9c8";
      context.fillRect(0, 0, 600, 320);
      context.fillStyle = "#28644e";
      context.font = "36px sans-serif";
      context.fillText("Domos · 方案预览", 50, 175);
      return canvas.toDataURL("image/png").split(",")[1] ?? "";
    }),
    "base64",
  );
  const files: Attachment[] = [];
  for (const [name, data] of [
    ["方案.png", image],
    [
      "演示.mp4",
      await readFile(
        new URL(
          "../../../packages/agent/test/fixtures/media/video.mp4",
          import.meta.url,
        ),
      ),
    ],
    [
      "配音.mp3",
      await readFile(
        new URL(
          "../../../packages/agent/test/fixtures/media/audio.mp3",
          import.meta.url,
        ),
      ),
    ],
    ["方案说明.md", Buffer.from("# 设计说明\n比较方案后再选择。")],
  ] as const) {
    const response = await page.request.put(
      `${service.url}/files/${botId}/upload?name=${encodeURIComponent(name)}&requestId=${crypto.randomUUID()}`,
      { data },
    );
    expect(response.ok()).toBe(true);
    files.push(await response.json());
  }
  let attempts = 0;
  let fail = true;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/rpc/engines/answer", async (route) => {
    attempts++;
    if (fail)
      return route.fulfill({ status: 500, json: { message: "提交失败" } });
    await gate;
    await route.continue();
  });
  service.worker.send({
    approval: {
      id: "rich-question",
      kind: "question",
      title: "你更喜欢哪种呈现？",
      detail: "可以先查看、播放和比较，再告诉我你的选择。",
      footer: "附件包含各方案的参考材料。",
      attachments: [files[3]],
      questions: [
        {
          id: "presentation",
          title: "你更喜欢哪种呈现？",
          allowOther: true,
          options: Array.from({ length: 5 }, (_, index) => ({
            id: `candidate-${index}`,
            label: [
              "静态图片",
              "视频演示",
              "音频解说",
              "文字说明",
              "另一种方案",
            ][index],
            description: "先了解内容，再决定下一步。",
            attachments: index < 4 ? [files[index]] : undefined,
            actions:
              index === 0
                ? [
                    { id: `learn-${index}`, label: "了解更多" },
                    { id: `select-${index}`, label: "选择这一版" },
                  ]
                : undefined,
          })),
        },
      ],
    },
  });
  const card = page.getByRole("region", {
    name: "你更喜欢哪种呈现？",
    exact: true,
  });
  await expect(card).toBeVisible();
  await expect(card.locator(".question-candidate")).toHaveCount(5);
  await expect(card.locator(".question-utilities")).toContainText("自己填写");
  await expect(card.getByRole("button", { name: /显示更多选项/ })).toHaveCount(
    0,
  );
  for (const row of await card.locator(".question-reply").all())
    await expect(row).toHaveCSS("text-align", "center");
  await expect(card.locator("audio")).toHaveCount(0);
  await expect(card.locator("video")).toHaveCount(0);
  await card
    .getByRole("button", { name: "预览 方案.png", exact: true })
    .click();
  const filePreview = page.getByRole("complementary", {
    name: "文件预览",
    exact: true,
  });
  await expect(filePreview).toBeVisible();
  await filePreview.getByRole("button", { name: "关闭", exact: true }).click();
  expect(attempts).toBe(0);
  await card
    .getByRole("button", { name: "预览 演示.mp4", exact: true })
    .click();
  await expect(page.locator("video")).toBeVisible();
  expect(
    await page
      .locator("video")
      .evaluate((video: HTMLVideoElement) => video.paused),
  ).toBe(true);
  expect(attempts).toBe(0);
  await page
    .getByRole("complementary", { name: "文件预览", exact: true })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "文件预览", exact: true }),
  ).not.toBeVisible();
  await expect(page.locator(".attention-toast")).toHaveCount(0, {
    timeout: 10000,
  });
  const grid = card.locator(".question-candidates");
  const layout = () =>
    grid.evaluate((element) => ({
      overflow: element.scrollWidth - element.clientWidth,
      columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
      rows: [...element.children].map((child) =>
        Math.round(child.getBoundingClientRect().top),
      ),
    }));
  await expect.poll(async () => (await layout()).columns).toBe(2);
  expect((await layout()).overflow).toBeLessThanOrEqual(1);
  expect(new Set((await layout()).rows).size).toBe(3);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath(`rich-question-${colorScheme}.png`),
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await expect.poll(async () => (await layout()).columns).toBe(1);
  expect((await layout()).overflow).toBeLessThanOrEqual(1);
  expect(new Set((await layout()).rows).size).toBe(5);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("rich-question-narrow.png"),
    animations: "disabled",
  });
  await expect(card.locator(".question-candidate")).toHaveCount(5);
  await page.setViewportSize({ width: 1360, height: 900 });
  const choose = card
    .getByRole("button", { name: "选择这一版", exact: true })
    .first();
  await choose.click();
  await expect(card.getByRole("alert")).toBeVisible();
  await expect(card).toHaveAttribute("data-state", "pending");
  fail = false;
  const reply = new Promise<{ answer: { answers: Record<string, string[]> } }>(
    (resolve) => {
      const receive = (value: {
        type: string;
        answer: { answers: Record<string, string[]> };
      }) => {
        if (value.type !== "answered") return;
        service.worker.off("message", receive);
        resolve(value);
      };
      service.worker.on("message", receive);
    },
  );
  await choose.focus();
  await page.keyboard.press("Enter");
  await expect(choose).toBeDisabled();
  await page.keyboard.press("Enter");
  expect(attempts).toBe(2);
  release();
  expect((await reply).answer.answers).toEqual({ presentation: ["select-0"] });
  await expect(card).toHaveAttribute("data-state", "answered");
  await expect(card.locator(".question-candidate")).toHaveCount(5);
  await expect(card.locator(".question-reply[data-selected]")).toContainText(
    "选择这一版",
  );
  const latest = page.getByRole("button", { name: "返回最新", exact: true });
  if (await latest.isVisible()) await latest.click();
  await expect(page.locator(".message-reply")).toContainText(
    "你更喜欢哪种呈现？",
  );
  await page.reload();
  await expect(card.locator(".question-reply[data-selected]")).toContainText(
    "选择这一版",
  );
  await expect(card.locator(".question-candidate")).toHaveCount(5);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({
      path: info.outputPath(`rich-question-answered-${colorScheme}.png`),
    });
  }
});
