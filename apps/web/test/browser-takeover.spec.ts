import { type ChildProcess, fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
test.beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "domos-takeover-"));
  worker = fork(
    fileURLToPath(
      new URL("../../api/test/fixtures/web-server.ts", import.meta.url),
    ),
    [
      join(directory, "data.sqlite"),
      "0",
      test.info().title.includes("takeover card") ? "takeover" : "",
    ],
    { silent: true, execArgv: [] },
  );
  worker.stdout?.resume();
  worker.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  const [ready] = await once(worker, "message");
  url = `http://127.0.0.1:${ready.port}`;
});
test.afterEach(async () => {
  if (worker.connected) {
    const exited = once(worker, "exit");
    worker.disconnect();
    await exited;
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 5 });
});

async function openBrowser(page: import("@playwright/test").Page) {
  await page.goto(url);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await page.getByRole("tab", { name: "Browser", exact: true }).click();
  const view = page.getByRole("region", { name: "Domos的电脑", exact: true });
  await view.getByRole("button", { name: "启用浏览器", exact: true }).click();
  const image = view.getByRole("img", { name: "工作电脑画面" });
  await expect(image).toBeVisible();
  const opened = once(worker, "message");
  worker.send("open-takeover-page");
  const [result] = await opened;
  expect(result.type).toBe("takeover-page-opened");
  await view.getByRole("button", { name: "接管", exact: true }).click();
  await expect(view.getByRole("status")).toHaveText("你正在操作", {
    timeout: 35_000,
  });
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  return { view, image, modifier };
}

async function point(
  image: import("@playwright/test").Locator,
  state: {
    width: number;
    height: number;
    draft: { x: number; y: number; width: number; height: number };
    hover: { x: number; y: number; width: number; height: number };
    confirm: { x: number; y: number; width: number; height: number };
  },
  name: "draft" | "hover" | "confirm",
  fraction = 0.5,
) {
  const rect = await image.boundingBox();
  if (!rect) throw new Error("Page image missing");
  await expect
    .poll(() =>
      image.evaluate(
        (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
      ),
    )
    .toBe(true);
  const size = await image.evaluate((node: HTMLImageElement) => ({
    width: node.naturalWidth,
    height: node.naturalHeight,
  }));
  const scale = Math.min(rect.width / size.width, rect.height / size.height);
  const width = size.width * scale,
    height = size.height * scale;
  const target = state[name];
  return {
    x:
      rect.x +
      (rect.width - width) / 2 +
      ((target.x + target.width * fraction) * width) / state.width,
    y:
      rect.y +
      (rect.height - height) / 2 +
      ((target.y + target.height / 2) * height) / state.height,
  };
}

for (const refresh of [false, true]) {
  test(`takeover card first click opens the browser and resumes after completion (refresh=${refresh})`, async ({
    page,
    request,
  }, info) => {
    let watches = 0;
    await page.route("**/rpc/computer/watch", async (route) => {
      watches++;
      await route.continue();
    });
    await page.addInitScript(() =>
      localStorage.setItem("domos:appearance:v1", "dark"),
    );
    test.setTimeout(60000);
    await page.goto(url);
    const view = page.getByRole("region", { name: "Domos的电脑", exact: true });
    const api = createORPCClient<RouterClient<AppRouter>>(
      new RPCLink({ url: `${url}/rpc` }),
    );
    await api.computer.service({ botId: 1, service: "browser", enabled: true });
    const binding = await api.computer.get({ botId: 1 });
    if (!binding.computerId) throw new Error("Computer required");
    await api.computer.approval({
      botId: 1,
      computerId: binding.computerId,
      revision: binding.revision,
      mode: "auto",
    });
    const started = performance.now();
    await page
      .getByLabel("消息", { exact: true })
      .fill("打开搜索页，然后让我接管修改搜索词");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    const card = page.getByRole("region", { name: "接管请求", exact: true });
    await expect(card.locator(".takeover-url")).toContainText("127.0.0.1");
    await expect(card.getByText("等待接管", { exact: true })).toBeVisible();
    await expect(card.getByRole("img", { name: "消息图片" })).toBeVisible();
    const cardMs = performance.now() - started;
    if (refresh) await page.reload();
    await expect(card.getByText("等待接管", { exact: true })).toBeVisible();
    await page.screenshot({
      path: info.outputPath("takeover-card-waiting.png"),
    });
    const takeStarted = performance.now();
    await card.getByRole("button", { name: "接管", exact: true }).click();
    await expect(view.getByRole("status")).toHaveText("你正在操作");
    await expect(card.getByText("控制中", { exact: true })).toBeVisible();
    await expect(view.getByRole("alert")).toHaveCount(0);
    const grantMs = performance.now() - takeStarted;
    const left = page.getByRole("separator", { name: "调整联系人宽度" });
    const sidebar = page.locator('.workspace-panel[data-side="sidebar"]');
    await left.press("Home");
    await expect(sidebar).toHaveCSS("width", "96px");
    await left.press("ArrowRight");
    await expect(sidebar).toHaveCSS("width", "232px");
    await page.getByRole("separator", { name: "调整详情宽度" }).press("End");
    await expect(view.getByRole("status")).toHaveText("你正在操作");
    expect(watches).toBe(1);
    const state = await (await request.get(`${url}/takeover-state`)).json();
    const at = await point(
      view.getByRole("img", { name: "工作电脑画面" }),
      state,
      "draft",
    );
    await page.mouse.click(at.x, at.y);
    await page.keyboard.press(
      refresh || process.platform === "darwin" ? "Meta+a" : "Control+a",
    );
    const inputStarted = performance.now();
    await page.keyboard.insertText("京都天气");
    await expect
      .poll(
        async () =>
          (await (await request.get(`${url}/takeover-state`)).json()).value,
      )
      .toBe("京都天气");
    const inputReadbackMs = performance.now() - inputStarted;
    await expect
      .poll(
        () =>
          view
            .getByRole("img", { name: "工作电脑画面" })
            .evaluate((image: HTMLImageElement, state) => {
              const canvas = document.createElement("canvas");
              canvas.width = image.naturalWidth;
              canvas.height = image.naturalHeight;
              const context = canvas.getContext("2d");
              if (!context || !image.complete || !image.naturalWidth)
                return false;
              context.drawImage(image, 0, 0);
              const [r = 255, g = 0, b = 255] = context.getImageData(
                Math.floor((80 * image.naturalWidth) / state.width),
                Math.floor((40 * image.naturalHeight) / state.height),
                1,
                1,
              ).data;
              return r < 50 && g > 140 && b < 120;
            }, state),
        { intervals: [16, 16, 32], timeout: 5000 },
      )
      .toBe(true);
    const inputToPaintMs = performance.now() - inputStarted;
    await card.getByRole("button", { name: "我已完成", exact: true }).click();
    await expect(card.getByText("已归还", { exact: true })).toBeVisible();
    await expect(card.getByRole("button")).toHaveCount(0);
    await expect(
      page
        .getByRole("log", { name: "聊天记录" })
        .getByText(/接管已完成，重新观察：/),
    ).toContainText("京都天气");
    const tools = await (await request.get(`${url}/takeover-metrics`)).json();
    expect(tools.map((item: { name: string }) => item.name)).toEqual([
      "browser_agent_browser_open",
      "browser_agent_browser_observe",
    ]);
    const metrics = info.outputPath("takeover-flow.json");
    await writeFile(
      metrics,
      JSON.stringify(
        {
          runner: process.platform,
          model: "scripted Harness; no online model",
          refresh,
          firstClickSuccess: true,
          falseConflicts: 0,
          cardMs,
          grantMs,
          inputReadbackMs,
          inputToPaintMs,
          elapsedMs: performance.now() - started,
          tools,
        },
        null,
        2,
      ),
    );
    await info.attach("takeover-flow", {
      path: metrics,
      contentType: "application/json",
    });
    await page.screenshot({ path: info.outputPath("takeover-card-done.png") });
    await page.reload();
    await expect(card.getByText("已归还", { exact: true })).toBeVisible();
    if (!refresh) {
      await page.getByRole("button", { name: "Bot详情", exact: true }).click();
      await page.getByRole("tab", { name: "Browser", exact: true }).click();
      await view.getByRole("button", { name: "电脑设置", exact: true }).click();
      await page
        .getByRole("button", { name: /尝试有界面模式|切换为无界面/ })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "重启并切换浏览器？",
        exact: true,
      });
      await expect(dialog).toContainText("未提交的内容会关闭");
      await page.screenshot({
        path: info.outputPath("browser-mode-dialog.png"),
      });
      await dialog
        .getByRole("button", { name: "确认重启", exact: true })
        .click();
      await expect(dialog).toBeHidden({ timeout: 30000 });
      await page.getByRole("button", { name: "返回", exact: true }).click();
      await page.getByRole("tab", { name: "Browser", exact: true }).click();
      const opened = once(worker, "message");
      worker.send("open-takeover-page");
      await opened;
      await view.getByRole("button", { name: "接管", exact: true }).click();
      await expect(view.getByRole("status")).toHaveText("你正在操作");
      const image = view.getByRole("img", { name: "工作电脑画面" });
      const state = await (await request.get(`${url}/takeover-state`)).json();
      const at = await point(image, state, "draft");
      await page.mouse.click(at.x, at.y);
      const keyboard = view.getByRole("textbox", { name: "网页键盘输入" });
      await keyboard.press(
        `${process.platform === "darwin" ? "Meta" : "Control"}+A`,
      );
      await keyboard.pressSequentially("mode-switch");
      await expect
        .poll(
          async () =>
            (await (await request.get(`${url}/takeover-state`)).json()).value,
        )
        .toBe("mode-switch");
      await view.getByRole("button", { name: "交还", exact: true }).click();
    }
  });
}

test("continuous wheel input keeps takeover active", async ({
  page,
  request,
}, info) => {
  test.setTimeout(60000);
  const { view, image } = await openBrowser(page);
  const state = await (await request.get(`${url}/takeover-state`)).json();
  const at = await point(image, state, "draft");
  const latencies: number[] = [];
  const sent = new Map<import("@playwright/test").Request, number>();
  page.on("request", (request) => {
    if (
      request.url().endsWith("/rpc/computer/input") &&
      request.postDataJSON()?.json?.action?.type === "pointer"
    )
      sent.set(request, performance.now());
  });
  page.on("requestfinished", (request) => {
    const start = sent.get(request);
    if (start !== undefined) {
      latencies.push(performance.now() - start);
      sent.delete(request);
    }
  });
  const started = performance.now();
  const observed = await image.evaluate(async (node, at) => {
    let frames = 0,
      accepted = 0;
    const loaded = () => frames++;
    node.addEventListener("load", loaded);
    const started = performance.now();
    for (let index = 0; index < 120; index++) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: at.x,
        clientY: at.y,
        deltaY: index % 20 < 10 ? 30 : -30,
      });
      node.dispatchEvent(event);
      if (event.defaultPrevented) accepted++;
    }
    node.removeEventListener("load", loaded);
    return {
      accepted,
      frames,
      frameRate: (frames * 1000) / (performance.now() - started),
    };
  }, at);
  expect(observed.accepted).toBe(120);
  expect(observed.frames).toBeGreaterThan(0);
  await expect(view.getByRole("status")).toHaveText("你正在操作");
  await expect(view.getByRole("alert")).toHaveCount(0);
  await view.getByRole("button", { name: "交还", exact: true }).click();
  await expect(view.getByRole("status")).toHaveText("实时");
  const metrics = info.outputPath("continuous-input.json");
  await writeFile(
    metrics,
    JSON.stringify({
      inputEvents: 120,
      elapsedMs: performance.now() - started,
      pauses: 0,
      runner: process.platform,
      ...observed,
      inputReplyP95Ms: latencies.sort((a, b) => a - b)[
        Math.floor(latencies.length * 0.95)
      ],
    }),
  );
  await info.attach("continuous-input", {
    path: metrics,
    contentType: "application/json",
  });
});

test("takeover controls the Agent browser and preserves its layout through fullscreen", async ({
  page,
  request,
}, info) => {
  test.setTimeout(120_000);
  const { view, image, modifier } = await openBrowser(page);
  const state = async () => (await request.get(`${url}/takeover-state`)).json();
  await expect.poll(async () => (await state()).value).toBe("saved draft");
  await expect(
    view.getByRole("textbox", { name: "网址", exact: true }),
  ).toHaveCount(0);
  await expect(
    view.getByRole("button", { name: "输入文字", exact: true }),
  ).toHaveCount(0);
  const at = await point(image, await state(), "draft");
  await page.mouse.click(at.x, at.y);
  await page.keyboard.press("End");
  await page.keyboard.insertText("追加中文");
  await expect
    .poll(async () => (await state()).value)
    .toBe("saved draft追加中文");
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.insertText("上海天气");
  await expect.poll(async () => (await state()).value).toBe("上海天气");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Backspace");
  await expect.poll(async () => (await state()).value).toBe("上海气");
  await page.keyboard.press("End");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText(" 粘贴"));
  await page.keyboard.press(`${modifier}+v`);
  await expect.poll(async () => (await state()).value).toBe("上海气 粘贴");
  const ime = await page.context().newCDPSession(page);
  await ime.send("Input.imeSetComposition", {
    text: "中文",
    selectionStart: 2,
    selectionEnd: 2,
  });
  expect((await state()).value).toBe("上海气 粘贴");
  await ime.send("Input.insertText", { text: "中文" });
  await ime.detach();
  await expect.poll(async () => (await state()).value).toBe("上海气 粘贴中文");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("next field");
  await expect.poll(async () => (await state()).next).toBe("next field");
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await state()).keys.includes("Enter"))
    .toBe(true);
  const confirm = await point(image, await state(), "confirm");
  await page.mouse.click(confirm.x, confirm.y);
  await expect
    .poll(async () => (await state()).confirmed)
    .toBe("上海气 粘贴中文");
  const start = await point(image, await state(), "draft", 0.025),
    end = await point(image, await state(), "draft", 0.3);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await expect
    .poll(
      async () => (await state()).selection[1] - (await state()).selection[0],
    )
    .toBeGreaterThan(0);
  await page.mouse.up();
  await expect
    .poll(async () => {
      const s = (await state()).selection;
      return s[1] - s[0];
    })
    .toBeGreaterThan(0);
  await page.mouse.move(confirm.x, confirm.y);
  await page.mouse.down();
  await page.keyboard.press("Shift+Escape");
  await page.mouse.up();
  const hover = await point(image, await state(), "hover");
  await page.mouse.move(hover.x, hover.y);
  await expect.poll(async () => (await state()).hovered).toBe(true);
  expect((await state()).clicks).toBe(1);
  await page.mouse.wheel(0, 300);
  await expect.poll(async () => (await state()).scrollDone).toBeGreaterThan(0);
  await expect.poll(async () => (await state()).scrollY).toBeGreaterThan(0);
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await state()).scrollDone).toBeGreaterThan(1);
  await expect.poll(async () => (await state()).scrollY).toBe(0);
  const header = page.locator(".detail-identity");
  const before = await header.boundingBox();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(image).toBeInViewport({ ratio: 1 });
    await expect(
      view.getByRole("button", { name: "全屏", exact: true }),
    ).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`viewer-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await view.getByRole("button", { name: "全屏", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement?.className))
    .toBe("computer-viewer");
  await expect(
    view.getByRole("button", { name: "退出全屏", exact: true }),
  ).toBeInViewport();
  await expect(view.getByRole("status")).toHaveText("你正在操作");
  await page.screenshot({ path: info.outputPath("viewer-fullscreen.png") });
  await page.keyboard.press("Escape");
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement === null))
    .toBe(true);
  await expect(view.getByRole("status")).toHaveText("你正在操作");
  await expect(header).toBeVisible();
  expect((await header.boundingBox())?.height).toBe(before?.height);
  await view.getByRole("button", { name: "交还", exact: true }).click();
  await expect(
    view.getByRole("button", { name: "接管", exact: true }),
  ).toBeVisible();
  expect((await state()).value).toBe("上海气 粘贴中文");
});

test("a failed browser input pauses the viewer and reconnect never replays it", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const { view, image } = await openBrowser(page);
  const state = async () => (await request.get(`${url}/takeover-state`)).json();
  await expect.poll(async () => (await state()).value).toBe("saved draft");
  const at = await point(image, await state(), "draft");
  await page.mouse.click(at.x, at.y);
  let calls = 0;
  await page.route("**/rpc/computer/input", async (route) => {
    if (route.request().postDataJSON()?.json?.action?.type === "text") {
      calls++;
      await route.abort();
    } else await route.continue();
  });
  await page.keyboard.insertText("测试文字");
  await expect(view.getByRole("status")).toHaveText("操作已暂停");
  expect(calls).toBe(1);
  expect((await state()).value).toBe("saved draft");
  await page.unroute("**/rpc/computer/input");
  await view.getByRole("button", { name: "重新连接", exact: true }).click();
  await expect(
    view.getByRole("button", { name: "接管", exact: true }),
  ).toBeEnabled();
  expect((await state()).value).toBe("saved draft");
});
