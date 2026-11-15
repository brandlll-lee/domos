import { once } from "node:events";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { expect } from "@playwright/test";
import { png } from "../../../packages/agent/test/fixtures/png.ts";
import type { AppRouter } from "../../api/src/router.ts";
import {
  chooseAppearance,
  expectTextContrast,
  openDetails,
} from "./fixtures/chat-ui.ts";
import { test } from "./fixtures/service.ts";

test("context handoff scope stays readable in both themes and narrow panels", async ({
  service,
  page,
}, testInfo) => {
  const notice = "已交接摘要和近期原文。省略的细节可通过聊天记录查询。";
  await service.control({ handoff: notice });
  await page.goto(service.url);
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

test("long replies start at the top and background messages preserve a reader's place", async ({
  service,
  page,
}) => {
  await page.setViewportSize({ width: 1360, height: 600 });
  await service.control({ history: 12 });
  const answer = Array.from(
    { length: 18 },
    (_, index) => `第 ${index + 1} 项：资料已核对。`,
  ).join("\n\n");
  await service.control({ content: answer });
  await page.goto(service.url);
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
  await service.control({ content: "已完成。" });
  const rpc: RouterClient<AppRouter> = createORPCClient(
    new RPCLink({ url: `${service.url}/rpc` }),
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
  service,
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
  await page.goto(service.url);
  await service.control("gate");
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
  await service.control("release");
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(1);
  await page.evaluate(() => {
    (
      window as unknown as { deliveryMotion: { hidden: boolean } }
    ).deliveryMotion.hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
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
  await service.control("release");
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
  service,
  page,
}) => {
  await service.control({ history: 240 });
  await page.goto(service.url);
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
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  const bot = (await rpc.bots.list())[0];
  if (!bot) throw new Error("Bot required");
  await service.control({ content: "补页期间的新回复" });
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
  service,
  page,
}) => {
  await service.control({ history: 240 });
  await page.goto(service.url);
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
  service,
  page,
}) => {
  await service.control({ history: 240 });
  const rpc: RouterClient<AppRouter> = createORPCClient(
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  await rpc.bots.create({ name: "研究员", requestId: crypto.randomUUID() });
  await page.goto(service.url);
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

test("chat reads older pages and retains them through live updates", async ({
  service,
  page,
}) => {
  const receipt = once(service.worker, "message");
  service.worker.send({ history: 160 });
  await receipt;
  await page.goto(service.url);
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
  const scripted = once(service.worker, "message");
  service.worker.send({ content: "翻页后已完成" });
  await scripted;
  await page.getByLabel("消息", { exact: true }).fill("翻页后发送");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByLabel("Domos 的回复").last()).toContainText(
    "翻页后已完成",
  );
  while (await earlier.isVisible()) await earlier.click();
  await expect(page.getByLabel("你的消息").first()).toHaveText("历史任务 1");
});

test("late history updates and reconnect snapshots retain the reading anchor", async ({
  service,
  page,
}, info) => {
  const receipt = once(service.worker, "message");
  service.worker.send({ history: 50 });
  await receipt;
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
  const replies = snapshot.messages.filter(
    (message: { role: string }) => message.role === "assistant",
  );
  const late = [replies[2], replies[10]];
  const initial = {
    ...snapshot,
    messages: snapshot.messages.filter(
      (message: { id: string }) => !late.some((item) => item.id === message.id),
    ),
  };
  await page.addInitScript((initial) => {
    const fetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const input = args[0];
      const url = input instanceof Request ? input.url : String(input);
      if (!url.endsWith("/rpc/changes")) return fetch(...args);
      const stream = new ReadableStream({
        start(controller) {
          const deliver = (event: unknown) =>
            controller.enqueue(
              new TextEncoder().encode(
                `event: message\ndata: ${JSON.stringify({ json: event })}\n\n`,
              ),
            );
          Reflect.set(window, "deliverChatUpdate", deliver);
          deliver({ type: "snapshot", view: initial });
        },
      });
      return new Response(stream, {
        headers: { "content-type": "text/event-stream" },
      });
    };
  }, initial);
  await page.goto(service.url);
  await expect(page.getByLabel("Domos 的回复")).toHaveCount(48);
  const transcript = page.locator(".transcript");
  await transcript.evaluate((el) => {
    el.scrollTop = el.scrollHeight / 2;
  });
  await expect(
    page.getByRole("button", { name: "返回最新", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    const viewport = document.querySelector(".transcript");
    if (!viewport) throw new Error("Transcript required");
    const top = viewport.getBoundingClientRect().top;
    const node = [
      ...document.querySelectorAll<HTMLElement>("[data-transcript-key]"),
    ].find((el) => el.getBoundingClientRect().bottom > top);
    if (!node) throw new Error("Reading anchor required");
    const start = node.getBoundingClientRect().top;
    const samples: number[] = [];
    Reflect.set(window, "orderAnchorSamples", samples);
    Reflect.set(window, "sampleOrderAnchor", true);
    const sample = () => {
      samples.push(
        node.isConnected
          ? Math.abs(node.getBoundingClientRect().top - start)
          : Infinity,
      );
      if (Reflect.get(window, "sampleOrderAnchor"))
        requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.evaluate(
    (message) =>
      Reflect.get(
        window,
        "deliverChatUpdate",
      )({ type: "update", state: {}, messages: [message], removed: [] }),
    late[0],
  );
  await expect(page.locator(`[data-message-id="${late[0].id}"]`)).toHaveCount(
    1,
  );
  await page.evaluate(
    (view) =>
      Reflect.get(window, "deliverChatUpdate")({ type: "snapshot", view }),
    snapshot,
  );
  await expect(page.locator(`[data-message-id="${late[1].id}"]`)).toHaveCount(
    1,
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => (Reflect.get(window, "orderAnchorSamples") as number[]).length,
      ),
    )
    .toBeGreaterThan(2);
  const samples = await page.evaluate(() => {
    Reflect.set(window, "sampleOrderAnchor", false);
    return Reflect.get(window, "orderAnchorSamples") as number[];
  });
  expect(Math.max(...samples)).toBeLessThan(2);
  const ids = await page
    .locator("[data-message-id]")
    .evaluateAll((elements) =>
      elements.map((el) => el.getAttribute("data-message-id")),
    );
  expect(ids).toEqual(
    snapshot.messages
      .map((message: { id: string }) => message.id)
      .filter((id: string) => ids.includes(id)),
  );
  await info.attach("late-history-anchor", {
    body: JSON.stringify({ samples, maxShift: Math.max(...samples) }),
    contentType: "application/json",
  });
});

test("successive question updates keep earlier text in place through history and reconnect", async ({
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
  const text = {
    id: "sequence-text",
    role: "assistant",
    turnId: "sequence-turn",
    receivedAt: time,
    timestamp: time + 1,
    stopped: false,
    content: [
      {
        type: "text",
        text: "先查看这些方案，再告诉我你的选择。",
        key: "sequence-text",
      },
    ],
  };
  const cards = [1, 2, 3].map((index) => ({
    id: `sequence-question-${index}`,
    role: "assistant",
    turnId: "sequence-turn",
    timestamp: time + index * 100,
    stopped: false,
    pending: true,
    content: [],
    approval: {
      state: "pending",
      request: {
        id: `question-${index}`,
        kind: "question",
        title: `选择方案 ${index}`,
        detail: "",
        requestedAt: time + index * 100,
        options: [{ id: "a", label: "第一项" }],
      },
    },
  }));
  const initial = { ...snapshot, messages: [text], busy: true };
  await page.addInitScript((initial) => {
    const fetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const input = args[0];
      const address = input instanceof Request ? input.url : String(input);
      if (!address.endsWith("/rpc/changes")) return fetch(...args);
      const stream = new ReadableStream({
        start(controller) {
          const deliver = (event: unknown) =>
            controller.enqueue(
              new TextEncoder().encode(
                `event: message\ndata: ${JSON.stringify({ json: event })}\n\n`,
              ),
            );
          Reflect.set(window, "deliverQuestionSequence", deliver);
          deliver({
            type: "snapshot",
            view:
              JSON.parse(
                sessionStorage.getItem("questionSequence") ?? "null",
              ) ?? initial,
          });
        },
      });
      return new Response(stream, {
        headers: { "content-type": "text/event-stream" },
      });
    };
  }, initial);
  await page.goto(service.url);
  const row = page.locator('[data-message-id="sequence-text"]');
  await expect(row).toBeVisible();
  await row.evaluate((element) =>
    Reflect.set(window, "sequenceTextNode", element),
  );
  await page.evaluate(() => {
    const samples: string[][] = [];
    Reflect.set(window, "sequenceSamples", samples);
    Reflect.set(window, "sampleSequence", true);
    const sample = () => {
      samples.push(
        [...document.querySelectorAll("[data-message-id]")].map(
          (element) => element.getAttribute("data-message-id") ?? "",
        ),
      );
      if (Reflect.get(window, "sampleSequence")) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const expected = [text.id];
  const stored = [];
  for (const [index, card] of cards.entries()) {
    expected.push(card.id);
    await page.evaluate(
      (message) =>
        Reflect.get(
          window,
          "deliverQuestionSequence",
        )({ type: "update", state: {}, messages: [message], removed: [] }),
      card,
    );
    await expect
      .poll(() =>
        page
          .locator("[data-message-id]")
          .evaluateAll((elements) =>
            elements.map((element) => element.getAttribute("data-message-id")),
          ),
      )
      .toEqual(expected);
    const settled = {
      ...card,
      pending: false,
      cursor: `${index + 1}:0`,
      approval: {
        ...card.approval,
        state: ["answered", "denied", "expired"][index],
      },
    };
    stored.push(settled);
    await page.evaluate(
      (message) =>
        Reflect.get(
          window,
          "deliverQuestionSequence",
        )({ type: "update", state: {}, messages: [message], removed: [] }),
      settled,
    );
    await expect
      .poll(() =>
        page
          .locator("[data-message-id]")
          .evaluateAll((elements) =>
            elements.map((element) => element.getAttribute("data-message-id")),
          ),
      )
      .toEqual(expected);
    expect(
      await row.evaluate(
        (element) => element === Reflect.get(window, "sequenceTextNode"),
      ),
    ).toBe(true);
  }
  const history = {
    ...snapshot,
    messages: [...stored, { ...text, cursor: "100:0", timestamp: time + 1000 }],
    busy: false,
  };
  await page.evaluate((view) => {
    sessionStorage.setItem("questionSequence", JSON.stringify(view));
    Reflect.get(window, "deliverQuestionSequence")({ type: "snapshot", view });
  }, history);
  await expect
    .poll(() =>
      page
        .locator("[data-message-id]")
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute("data-message-id")),
        ),
    )
    .toEqual(expected);
  await expect
    .poll(() =>
      page.evaluate(
        () => (Reflect.get(window, "sequenceSamples") as string[][]).length,
      ),
    )
    .toBeGreaterThan(2);
  const samples = await page.evaluate(() => {
    Reflect.set(window, "sampleSequence", false);
    return Reflect.get(window, "sequenceSamples") as string[][];
  });
  for (const ids of samples)
    expect(ids).toEqual(expected.filter((id) => ids.includes(id)));
  await info.attach("question-sequence-frames", {
    body: JSON.stringify(samples),
    contentType: "application/json",
  });
  await page.reload();
  await expect
    .poll(() =>
      page
        .locator("[data-message-id]")
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute("data-message-id")),
        ),
    )
    .toEqual(expected);
});
