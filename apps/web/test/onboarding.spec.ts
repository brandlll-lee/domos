import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, type TestInfo, test } from "@playwright/test";

async function capture(page: Page, info: TestInfo, name: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [1360, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true);
      const frame = page.locator(".setup-window");
      if (await frame.count()) {
        const box = await frame.boundingBox();
        expect(box?.y).toBe(0);
        expect(box?.height).toBe(900);
        await expect(
          page.locator(".startup-guide, .startup-loading"),
        ).toHaveCSS("overflow-y", /auto|scroll|clip/);
      }
      await page.screenshot({
        path: info.outputPath(`${name}-${colorScheme}-${width}.png`),
        animations: "disabled",
      });
    }
  }
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
}

test("first use prepares the default Bot with a computer and model before shared chat", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "domos-onboarding-web-"));
  const worker = fork(
    fileURLToPath(
      new URL("../../api/test/fixtures/onboarding-server.ts", import.meta.url),
    ),
    [join(directory, "data")],
    { silent: true, execArgv: [] },
  );
  worker.stdout?.resume();
  worker.stderr?.resume();
  try {
    const [ready] = (await once(worker, "message")) as [
      { port: number; code: string; clientCode: string },
    ];
    await page.route("**/rpc/engines/{get,configure}", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.json.prepared = false;
      await route.fulfill({ response, json: body });
    });
    const connectionRead = Promise.withResolvers<void>();
    await page.route(
      "**/hosting/session",
      async (route) => {
        await connectionRead.promise;
        await route.continue();
      },
      { times: 1 },
    );
    await page.goto(`http://127.0.0.1:${ready.port}`);
    try {
      await expect(page.locator(".startup-loading .startup-crt")).toBeVisible();
    } finally {
      connectionRead.resolve();
    }
    await expect(
      page.getByRole("heading", { name: "连接这个 Domos" }),
    ).toBeVisible();
    await capture(page, testInfo, "pairing");
    await page.getByLabel("配对码", { exact: true }).fill(ready.code);
    await page.route("**/hosting/exchange", (route) => route.abort());
    await page.getByRole("button", { name: "确认连接", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByLabel("配对码", { exact: true })).toHaveValue(
      ready.code,
    );
    await page.unroute("**/hosting/exchange");
    const configurationRead = Promise.withResolvers<void>();
    await page.route("**/rpc/bots/list", async (route) => {
      await configurationRead.promise;
      await route.continue();
    });
    try {
      await page.getByRole("button", { name: "确认连接", exact: true }).click();
      await expect(page.locator(".startup-loading .startup-crt")).toBeVisible();
    } finally {
      configurationRead.resolve();
      await page.unroute("**/rpc/bots/list");
    }
    const setup = page.locator(".startup-guide");
    await expect(
      setup.getByRole("heading", { name: "连接你的 AI" }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toBeHidden();
    await expect(
      setup.getByRole("textbox", { name: "名字", exact: true }),
    ).toHaveCount(0);
    await expect(
      setup.getByRole("textbox", { name: "职责与长期指令" }),
    ).toHaveCount(0);
    const inspections: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/rpc/engines/inspect"))
        inspections.push(request.url());
    });
    await expect(
      setup.getByRole("button", { name: "Pi", exact: true }),
    ).toBeVisible();
    const deferred = await browser.newContext({
      storageState: await page.context().storageState(),
    });
    try {
      const workspace = await deferred.newPage();
      await workspace.goto(page.url());
      await workspace.getByRole("button", { name: /暂时跳过/ }).click();
      await expect(
        workspace.getByRole("textbox", { name: "消息", exact: true }),
      ).toBeVisible();
      await workspace.reload();
      await expect(
        workspace.getByRole("textbox", { name: "消息", exact: true }),
      ).toBeVisible();
      await expect(workspace.locator(".startup-guide")).toHaveCount(0);
    } finally {
      await deferred.close();
    }
    expect(inspections).toHaveLength(0);
    await capture(page, testInfo, "connection-list");
    await setup.getByRole("button", { name: "Pi", exact: true }).click();
    const viewport = setup.locator(".startup-viewport");
    await expect(viewport).toHaveAttribute("data-travelling", "");
    await expect(
      setup.getByText("允许 Domos 运行本机程序并访问文件", { exact: true }),
    ).toBeVisible();
    expect(inspections).toHaveLength(0);
    await expect(viewport).not.toHaveAttribute("data-travelling", "");
    const view = await viewport.boundingBox();
    if (!view) throw new Error("Startup viewport is missing");
    const x = view.x + view.width * 0.03;
    let hit = false;
    for (let y = view.y + 10; y < view.y + view.height; y += 12) {
      await page.mouse.move(x, y);
      if (!((await viewport.getAttribute("data-return-hover")) === ""))
        continue;
      await page.mouse.click(x, y);
      hit = true;
      break;
    }
    expect(hit).toBe(true);
    await setup.getByRole("button", { name: "Pi", exact: true }).click();
    await expect(viewport).not.toHaveAttribute("data-travelling", "");
    await capture(page, testInfo, "computer-setup");
    await page.setViewportSize({ width: 390, height: 600 });
    const next = setup.getByRole("button", {
      name: "允许访问并继续",
      exact: true,
    });
    await next.scrollIntoViewIfNeeded();
    await expect(next).toBeInViewport();
    await page.setViewportSize({ width: 1360, height: 900 });
    await expect(setup.getByRole("radiogroup")).toHaveCount(0);
    await page.route("**/rpc/computer/authorize", (route) => route.abort());
    await setup
      .getByRole("button", { name: "允许访问并继续", exact: true })
      .click();
    await expect(setup.getByRole("alert")).toBeVisible();
    await expect(setup).toBeVisible();
    await page.unroute("**/rpc/computer/authorize");
    await setup
      .getByRole("button", { name: "允许访问并继续", exact: true })
      .click();
    await expect(
      setup.getByRole("heading", { name: "给 Bot 选一个模型" }),
    ).toBeVisible();
    await expect(viewport).not.toHaveAttribute("data-travelling", "");
    await setup.getByRole("button", { name: "返回", exact: true }).click();
    await setup
      .getByRole("button", { name: "自定义 ACP", exact: true })
      .click();
    await expect(viewport).not.toHaveAttribute("data-travelling", "");
    await expect(
      setup.getByRole("button", { name: "检查连接", exact: true }),
    ).toBeEnabled();
    await setup.getByLabel("程序路径", { exact: true }).fill("custom-agent");
    await setup.getByLabel("启动参数", { exact: true }).fill("invalid");
    await setup.getByRole("button", { name: "检查连接", exact: true }).click();
    await expect(page.locator(".attention-toast[data-error]")).toContainText(
      "JSON 字符串数组",
    );
    await expect(setup.getByLabel("程序路径", { exact: true })).toHaveValue(
      "custom-agent",
    );
    await setup.getByRole("button", { name: "返回", exact: true }).click();
    const connection = {
      ready: false,
      authenticated: false,
      models: [],
      version: null,
      path: null,
      message: "需要下载程序",
    };
    await page.route("**/rpc/engines/inspect", (route) => {
      if (route.request().postDataJSON().json.config?.provider !== "codex")
        return route.continue();
      return route.fulfill({ json: { json: connection } });
    });
    const installing = Promise.withResolvers<void>();
    await page.route("**/rpc/engines/install", async (route) => {
      await installing.promise;
      await route.abort();
    });
    await setup.getByRole("button", { name: "Codex", exact: true }).click();
    const install = setup.getByRole("button", {
      name: "下载并继续",
      exact: true,
    });
    const size = () =>
      install.evaluate((button: HTMLButtonElement) => [
        button.offsetWidth,
        button.offsetHeight,
      ]);
    const installSize = await size();
    await install.click();
    try {
      await expect(install).toBeDisabled();
      await expect(install.locator(".button-spinner")).toBeVisible();
      expect(await size()).toEqual(installSize);
    } finally {
      installing.resolve();
    }
    await expect(
      page
        .locator(".attention-toast[data-error]")
        .filter({ hasText: "Failed to fetch" }),
    ).toBeVisible();
    await expect(setup.locator(".setup-provider-name")).toHaveText("Codex");
    await capture(page, testInfo, "download-failure");
    connection.ready = true;
    await page.unroute("**/rpc/engines/install");
    await page.route("**/rpc/engines/install", (route) =>
      route.fulfill({
        json: {
          json: { config: { provider: "codex", model: null }, connection },
        },
      }),
    );
    await setup
      .getByRole("button", { name: "下载并继续", exact: true })
      .click();
    const login = {
      state: "waiting",
      url: null,
      code: null,
      prompt: null,
      instructions: "请在浏览器中完成登录。",
    };
    await page.route("**/rpc/engines/login", (route) =>
      route.fulfill({ json: { json: login } }),
    );
    await page.route("**/rpc/engines/loginState", (route) =>
      route.fulfill({ json: { json: login } }),
    );
    await page.route("**/rpc/engines/cancelLogin", (route) =>
      route.fulfill({ json: { json: null } }),
    );
    await setup.getByRole("button", { name: "登录", exact: true }).click();
    await expect(setup.getByText("等待登录…", { exact: true })).toBeVisible();
    await capture(page, testInfo, "login");
    const cancelled = page.waitForRequest("**/rpc/engines/cancelLogin");
    await setup.getByRole("button", { name: "取消", exact: true }).click();
    await cancelled;
    await expect(setup.getByText("等待登录…", { exact: true })).toBeHidden();
    await expect(setup.locator(".setup-provider-name")).toHaveText("Codex");
    await page.unroute("**/rpc/engines/inspect");
    await setup.getByRole("button", { name: "返回", exact: true }).click();
    await setup.getByRole("button", { name: "Pi", exact: true }).click();
    await expect(viewport).not.toHaveAttribute("data-travelling", "");
    await expect(
      setup.getByRole("button", { name: "开始聊天", exact: true }),
    ).toBeDisabled();
    const models = setup.getByRole("region", { name: "模型", exact: true });
    const focusedModel = (name: string) =>
      models.getByRole("button", { name: `确认模型 ${name}`, exact: true });
    await focusedModel("Faux Model").hover();
    await page.mouse.wheel(0, 130);
    await expect(focusedModel("Faux Model 2")).toBeVisible();
    await expect(
      setup.getByRole("button", { name: "开始聊天", exact: true }),
    ).toBeDisabled();
    await focusedModel("Faux Model 2").press("ArrowUp");
    await expect(focusedModel("Faux Model")).toBeFocused();
    await capture(page, testInfo, "model-setup");
    await setup
      .getByRole("button", { name: "确认模型 Faux Model", exact: true })
      .click();
    await setup.getByRole("button", { name: "开始聊天", exact: true }).click();
    await expect(setup).toBeHidden();
    await page
      .getByRole("textbox", { name: "消息", exact: true })
      .fill("开始工作");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByRole("log", { name: "聊天记录" })).toContainText(
      "模型已回复。",
    );
    await page.reload();
    await expect(setup).toBeHidden();
    await expect(page.getByRole("log", { name: "聊天记录" })).toContainText(
      "开始工作",
    );
    const remote = await browser.newContext();
    try {
      const second = await remote.newPage();
      await second.goto(`http://127.0.0.1:${ready.port}`);
      await second.getByLabel("配对码", { exact: true }).fill(ready.clientCode);
      await second
        .getByRole("button", { name: "确认连接", exact: true })
        .click();
      await expect(second.getByRole("log", { name: "聊天记录" })).toContainText(
        "模型已回复。",
      );
      await second.getByRole("button", { name: "新建", exact: true }).click();
      await second
        .getByRole("menuitem", { name: "新建 Bot", exact: true })
        .click();
      const create = second.getByRole("dialog", {
        name: "新建 Bot",
        exact: true,
      });
      await expect(
        create.getByText("不同的事，交给不同的 Bot", { exact: true }),
      ).toBeVisible();
      await second.screenshot({ path: testInfo.outputPath("second-bot.png") });
      await create.getByLabel("名字", { exact: true }).fill("资料伙伴");
      await create.getByRole("button", { name: "创建", exact: true }).click();
      await expect(
        create.getByRole("button", { name: "允许访问并继续", exact: true }),
      ).toHaveCount(0);
      await create.getByRole("button", { name: "Pi", exact: true }).click();
      await create.getByRole("combobox", { name: "模型", exact: true }).click();
      await second
        .getByRole("option", { name: "Pi · Faux Model", exact: true })
        .click();
      await create
        .getByRole("button", { name: "开始聊天", exact: true })
        .click();
      await expect(create).toBeHidden();
      await expect(second.getByLabel("消息", { exact: true })).toHaveAttribute(
        "data-placeholder",
        "发送消息给 资料伙伴…",
      );
    } finally {
      await remote.close();
    }
    await page.screenshot({ path: testInfo.outputPath("configured.png") });
  } finally {
    const exited = once(worker, "exit");
    worker.disconnect();
    await exited;
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  }
});
