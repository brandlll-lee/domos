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
        await expect(page.locator(".setup-page")).toHaveCSS(
          "overflow-y",
          (await page.locator(".engine-panel[data-setup]").count())
            ? "hidden"
            : "auto",
        );
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

async function engineLayout(page: Page, info: TestInfo) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const [width, height, fontSize] of [
      [1366, 768, "100%"],
      [1360, 900, "100%"],
      [390, 500, "100%"],
      [1366, 768, "125%"],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = size;
      }, fontSize);
      const start = await page
        .getByRole("button", { name: "开始使用", exact: true })
        .boundingBox();
      expect(start).not.toBeNull();
      if (!start) throw new Error("Setup actions required");
      expect(start.y + start.height).toBeLessThanOrEqual(height);
      expect(start.y).toBeGreaterThan(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollHeight <= innerHeight,
        ),
      ).toBe(true);
      if (width > 1000 && fontSize === "100%")
        expect(
          await page
            .locator(".engine-scroll .scroll-viewport")
            .evaluate(
              (element) => element.scrollHeight <= element.clientHeight,
            ),
        ).toBe(true);
      await page.screenshot({
        path: info.outputPath(
          `engine-${colorScheme}-${width}-${height}-${fontSize}.png`,
        ),
        animations: "disabled",
      });
    }
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
}

test("first use prepares the default Bot with a computer and engine before shared chat", async ({
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
    await page.goto(`http://127.0.0.1:${ready.port}`);
    await expect(
      page.getByRole("heading", { name: "连接这个 Domos" }),
    ).toBeVisible();
    await capture(page, testInfo, "pairing");
    await page.getByLabel("配对码", { exact: true }).fill(ready.code);
    await page.route("**/hosting/exchange", (route) => route.abort());
    await page.getByRole("button", { name: "连接", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByLabel("配对码", { exact: true })).toHaveValue(
      ready.code,
    );
    await page.unroute("**/hosting/exchange");
    await page.getByRole("button", { name: "连接", exact: true }).click();
    const setup = page.getByRole("main", { name: "首次设置" });
    await expect(
      setup.getByRole("heading", { name: "Bot 在哪里工作？" }),
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
    await expect(setup).toContainText("第 1 步，共 2 步");
    await capture(page, testInfo, "computer-setup");
    await page.setViewportSize({ width: 390, height: 600 });
    const next = setup.getByRole("button", { name: "授权并继续", exact: true });
    await next.scrollIntoViewIfNeeded();
    await expect(next).toBeInViewport();
    await page.setViewportSize({ width: 1360, height: 900 });
    const service = setup.getByRole("radio", { name: /^使用服务所在电脑/ });
    const title = await service.locator("strong").boundingBox();
    const description = await service
      .locator(".choice-description")
      .boundingBox();
    expect(description?.y).toBeGreaterThan(
      (title?.y ?? 0) + (title?.height ?? 0),
    );
    await page.screenshot({
      path: testInfo.outputPath("work-environment.png"),
    });
    await expect(
      setup.getByRole("heading", { name: "Bot 在哪里工作？" }),
    ).toBeVisible();
    await expect(
      setup.getByRole("radio", { name: /^共用一台隔离电脑/ }),
    ).toBeDisabled();
    await expect(
      setup.getByRole("button", { name: "返回", exact: true }),
    ).toHaveCount(0);
    await expect(service).toBeChecked();
    await page.route("**/rpc/computer/configure", (route) => route.abort());
    await setup
      .getByRole("button", { name: "授权并继续", exact: true })
      .click();
    await expect(setup.getByRole("alert")).toBeVisible();
    await expect(setup).toBeVisible();
    await page.unroute("**/rpc/computer/configure");
    await setup
      .getByRole("button", { name: "授权并继续", exact: true })
      .click();
    await expect(
      setup.getByRole("heading", { name: "由谁处理任务？" }),
    ).toBeVisible();
    await expect(
      setup.getByRole("heading", { name: "由谁处理任务？" }),
    ).toBeFocused();
    await setup.getByRole("button", { name: "返回", exact: true }).click();
    await expect(service).toBeChecked();
    await setup
      .getByRole("button", { name: "授权并继续", exact: true })
      .click();
    const engines = setup.getByRole("radiogroup", {
      name: "任务引擎",
      exact: true,
    });
    await expect(engines.getByRole("radio")).toHaveCount(4);
    await expect(engines.locator("svg.engine-mark")).toHaveCount(4);
    await expect(setup.locator("details, summary")).toHaveCount(0);
    await expect(setup.getByRole("combobox")).toHaveCount(0);
    const installs: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/engines/install"))
        installs.push(request.url());
    });
    let release = () => {};
    const checking = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/rpc/engines/inspect", async (route) => {
      await checking;
      await route.continue();
    });
    await engines.getByRole("radio", { name: /^Codex/ }).click();
    await expect(
      setup.getByRole("button", { name: "正在检查…", exact: true }),
    ).toHaveAttribute("aria-busy", "true");
    await expect(
      setup.getByRole("button", { name: "返回", exact: true }),
    ).toBeDisabled();
    release();
    await expect(
      setup.getByRole("button", { name: "开始使用", exact: true }),
    ).toBeEnabled();
    await page.unroute("**/rpc/engines/inspect");
    await expect(setup.getByText("1.0.0", { exact: true })).toBeVisible();
    await page.route("**/rpc/engines/inspect", (route) => route.abort());
    await setup.getByRole("button", { name: "重新检查", exact: true }).click();
    await expect(setup.getByRole("alert")).toBeVisible();
    await expect(
      setup.getByRole("button", { name: "开始使用", exact: true }),
    ).toBeDisabled();
    await page.unroute("**/rpc/engines/inspect");
    await setup.getByRole("button", { name: "重新检查", exact: true }).click();
    await expect(setup.getByRole("alert")).toHaveCount(0);
    await expect(
      setup.getByRole("button", { name: "开始使用", exact: true }),
    ).toBeEnabled();
    await engineLayout(page, testInfo);
    await setup.getByRole("button", { name: "账号设置", exact: true }).click();
    const account = page.getByRole("dialog", {
      name: "连接 Codex",
      exact: true,
    });
    await expect(
      account.getByRole("button", { name: "登录 Codex", exact: true }),
    ).toBeVisible();
    await account
      .getByRole("button", { name: "使用 API 密钥", exact: true })
      .click();
    await expect(
      account.getByLabel("OpenAI API 密钥", { exact: true }),
    ).toHaveAttribute("type", "password");
    await page.screenshot({
      path: testInfo.outputPath("codex-account-dialog.png"),
    });
    await page.keyboard.press("Escape");
    await expect(account).toBeHidden();
    await expect(
      setup.getByRole("button", { name: "账号设置", exact: true }),
    ).toBeFocused();
    expect(installs).toHaveLength(0);
    await engines.getByRole("radio", { name: /^Claude Code/ }).click();
    await setup
      .getByRole("button", { name: "安装 Claude Code", exact: true })
      .click();
    const install = page.getByRole("dialog", {
      name: "安装 Claude Code",
      exact: true,
    });
    await expect(
      install.getByText("只在所选工作电脑下载和安装。", { exact: true }),
    ).toBeVisible();
    await install
      .getByRole("button", { name: "关闭弹窗", exact: true })
      .click();
    await engines.getByRole("radio", { name: /^OpenCode/ }).click();
    await expect(setup.getByRole("alert")).toContainText("引擎未能启动");
    await expect(setup.getByRole("button", { name: /^安装/ })).toHaveCount(0);
    await setup.getByRole("button", { name: "重新检查", exact: true }).click();
    await expect(setup.getByRole("alert")).toContainText("引擎未能启动");
    await page.route("**/hosting/models", async (route) => {
      const response = await route.fetch();
      const catalog = await response.json();
      catalog.providers = catalog.providers.map((provider: { id: string }) =>
        provider.id === "faux"
          ? {
              ...provider,
              methods: [
                { type: "api_key", name: "API 密钥" },
                { type: "oauth", name: "网页登录" },
              ],
            }
          : provider,
      );
      catalog.models.push(
        ...Array.from({ length: 80 }, (_, index) => ({
          provider: "faux",
          modelId: `sample-${index}`,
          name: `示例模型 ${index}`,
        })),
        { provider: "additional", modelId: "extra", name: "Another Model" },
      );
      catalog.providers.push({
        id: "additional",
        name: "另一个服务",
        configured: true,
        methods: [{ type: "api_key", name: "API 密钥" }],
      });
      await route.fulfill({ response, json: catalog });
    });
    await engines.getByRole("radio", { name: /^Pi/ }).click();
    await setup.getByRole("button", { name: "连接模型", exact: true }).click();
    const model = page.getByRole("dialog", { name: "连接模型", exact: true });
    await page.setViewportSize({ width: 390, height: 500 });
    await expect(model).toBeVisible();
    await expect(
      model.getByRole("button", { name: "关闭弹窗", exact: true }),
    ).toBeInViewport();
    await expect(
      model.getByRole("button", { name: "完成", exact: true }),
    ).toHaveCount(0);
    await expect(
      model.getByRole("button", { name: /^Faux Model faux-1$/ }),
    ).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath("model-dialog-small.png"),
    });
    await page.setViewportSize({ width: 1360, height: 900 });
    const modelBox = await model.boundingBox();
    expect(modelBox?.height).toBeLessThan(550);
    expect(modelBox?.width).toBeGreaterThan(600);
    expect(modelBox?.y).toBeGreaterThan(80);
    await expect(model.locator(".brand-mark")).toBeVisible();
    await expect(
      model.locator(".engine-dialog-identity .engine-mark"),
    ).toBeVisible();
    const providers = model.getByRole("group", {
      name: "已连接的模型提供方",
      exact: true,
    });
    await providers
      .getByRole("button", { name: "另一个服务", exact: true })
      .click();
    await expect(
      model.getByRole("button", { name: "Another Model extra" }),
    ).toBeVisible();
    await expect(
      providers.getByRole("button", { name: "faux", exact: true }),
    ).toBeVisible();
    await providers.getByRole("button", { name: "faux", exact: true }).click();
    await page.screenshot({
      path: testInfo.outputPath("model-dialog-desktop.png"),
    });
    await expect(
      model.getByRole("button", { name: "重新登录", exact: true }),
    ).toHaveCount(0);
    await model.getByRole("button", { name: "管理账号", exact: true }).click();
    await expect(
      model.getByRole("combobox", { name: "连接方式", exact: true }),
    ).toBeVisible();
    let loginDone = false;
    await page.route("**/hosting/login", async (route) => {
      await route.fulfill({
        json: route.request().method() === "POST" ? { id: "ui-login" } : {},
      });
    });
    await page.route("**/hosting/login/ui-login", async (route) => {
      if (route.request().method() === "POST") loginDone = true;
      await route.fulfill({
        json: {
          done: loginDone,
          events: [],
          ...(loginDone
            ? {}
            : {
                prompt: { id: "key", type: "secret", message: "模型 API 密钥" },
              }),
        },
      });
    });
    await model.getByRole("button", { name: "重新登录", exact: true }).click();
    const key = model.getByLabel("模型 API 密钥", { exact: true });
    await expect(key).toHaveAttribute("type", "password");
    await key.fill("test-login-value");
    await model.getByRole("button", { name: "继续", exact: true }).click();
    await expect(
      model.getByRole("button", { name: "管理账号", exact: true }),
    ).toBeVisible();
    await expect(key).toHaveCount(0);
    await model
      .getByRole("button", { name: "添加提供方", exact: true })
      .click();
    await model.getByRole("combobox", { name: "模型提供方" }).click();
    await page
      .getByLabel("搜索提供方…", { exact: true })
      .fill("not-a-provider");
    await expect(
      page.getByText("没有找到提供方", { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await model
      .getByRole("button", { name: "添加提供方", exact: true })
      .click();
    const list = model.locator(".hosting-model-list-scroll .scroll-viewport");
    expect(
      await list.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(true);
    const lastOption = model.getByRole("button", { name: /示例模型 79/ });
    await lastOption.scrollIntoViewIfNeeded();
    await expect(lastOption).toBeInViewport();
    await model.getByLabel("搜索模型", { exact: true }).fill("Faux Model");
    await page.route("**/rpc/models/select", (route) => route.abort());
    await model.getByRole("button", { name: /^Faux Model faux-1$/ }).click();
    await expect(model.getByRole("alert")).toBeVisible();
    await expect(model).toBeVisible();
    await page.unroute("**/rpc/models/select");
    await page.screenshot({
      path: testInfo.outputPath("model-save-error.png"),
    });
    await model.getByRole("button", { name: /^Faux Model faux-1$/ }).click();
    await expect(model).toBeHidden();
    await expect(
      setup.getByRole("button", { name: "开始使用", exact: true }),
    ).toBeEnabled();
    await capture(page, testInfo, "engine-setup");
    await setup.getByRole("button", { name: "开始使用", exact: true }).click();
    await expect(setup).toBeHidden();
    await expect(
      page.getByRole("heading", { name: "想让我先帮你做什么？" }),
    ).toBeVisible();
    await page.reload();
    await expect(setup).toBeHidden();
    await expect(
      page.getByRole("heading", { name: "想让我先帮你做什么？" }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "消息", exact: true })
      .fill("确认首次配置成功");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(
      page
        .getByRole("log", { name: "聊天记录" })
        .getByText("模型已回复。", { exact: true }),
    ).toBeVisible();
    const remote = await browser.newContext();
    try {
      const second = await remote.newPage();
      await second.goto(`http://127.0.0.1:${ready.port}`);
      await second.getByLabel("配对码", { exact: true }).fill(ready.clientCode);
      await second.getByRole("button", { name: "连接", exact: true }).click();
      await expect(
        second
          .getByRole("log", { name: "聊天记录" })
          .getByText("模型已回复。", { exact: true }),
      ).toBeVisible();
      await second
        .getByRole("button", { name: "新建 Bot", exact: true })
        .click();
      const pairedCreate = second.getByRole("dialog", {
        name: "新建 Bot",
        exact: true,
      });
      await pairedCreate.getByLabel("名字", { exact: true }).fill("资料伙伴");
      await pairedCreate
        .getByRole("button", { name: "创建", exact: true })
        .click();
      await pairedCreate
        .getByRole("button", { name: "授权并继续", exact: true })
        .click();
      await pairedCreate
        .getByRole("button", { name: "连接模型", exact: true })
        .click();
      const pairedModel = second.getByRole("dialog", {
        name: "连接模型",
        exact: true,
      });
      await pairedModel
        .getByRole("combobox", { name: "模型", exact: true })
        .click();
      await second
        .getByRole("option", { name: "faux · Faux Model", exact: true })
        .click();
      await expect(pairedModel).toBeHidden();
      await pairedCreate
        .getByRole("button", { name: "开始使用", exact: true })
        .click();
      await expect(pairedCreate).toBeHidden();
      await second.getByRole("link", { name: "Domos", exact: true }).click();
      await page.getByRole("button", { name: "Bot详情", exact: true }).click();
      await page
        .getByRole("complementary", { name: /的详情$/ })
        .getByRole("button", { name: /^连接与账号(?:\s|$)/ })
        .click();
      const detailsModel = page.getByRole("combobox", {
        name: "模型",
        exact: true,
      });
      await detailsModel.click();
      await Promise.all([
        page.waitForResponse("**/rpc/engines/get"),
        page
          .getByRole("option", { name: "faux · Faux Model 2", exact: true })
          .click(),
      ]);
      await expect(detailsModel).toContainText("Faux Model 2");
      const engine = page.getByRole("region", {
        name: "任务引擎",
        exact: true,
      });
      await Promise.all([
        page.waitForResponse("**/rpc/engines/inspect"),
        engine.getByRole("button", { name: "检查连接", exact: true }).click(),
      ]);
      await expect(engine.getByRole("alert")).toHaveCount(0);
      await page.getByRole("button", { name: "关闭", exact: true }).click();
      await page
        .getByRole("button", { name: "选择引擎与模型", exact: true })
        .click();
      const selector = page.getByRole("dialog", {
        name: "任务引擎与模型",
        exact: true,
      });
      await selector.getByRole("tab", { name: "Codex", exact: true }).click();
      await selector
        .getByRole("button", { name: "Test Model", exact: true })
        .click();
      await expect(selector).toBeHidden();
      await expect(
        page.getByRole("button", { name: "选择引擎与模型", exact: true }),
      ).toContainText("Test Model");
      await page.getByRole("button", { name: "Bot详情", exact: true }).click();
      await page
        .getByRole("complementary", { name: /的详情$/ })
        .getByRole("button", { name: /^连接与账号\s/ })
        .click();
      await capture(page, testInfo, "engine-account");
      await engine
        .getByRole("button", { name: "重新检查", exact: true })
        .click();
      await page.getByRole("button", { name: "关闭", exact: true }).click();
      await page
        .getByRole("textbox", { name: "消息", exact: true })
        .fill("生成报告");
      await page.getByRole("button", { name: "发送", exact: true }).click();
      await expect(
        page.getByRole("region", { name: "允许这次操作？" }),
      ).toBeVisible();
      await expect(
        second.getByRole("region", { name: "允许这次操作？" }),
      ).toBeVisible();
      await capture(page, testInfo, "native-approval");
      await page.getByRole("button", { name: "Bot详情", exact: true }).click();
      await page
        .getByRole("complementary", { name: /的详情$/ })
        .getByRole("button", { name: /^连接与账号\s/ })
        .click();
      const enginePicker = engine.getByRole("combobox", {
        name: "任务引擎",
        exact: true,
      });
      await expect(enginePicker).toBeDisabled();
      await second
        .getByRole("button", { name: "允许这次操作", exact: true })
        .click();
      await expect(
        page
          .getByRole("log", { name: "聊天记录" })
          .getByText("Codex 已完成。", { exact: true }),
      ).toBeVisible();
      await expect(
        second
          .getByRole("log", { name: "聊天记录" })
          .getByText("Codex 已完成。", { exact: true }),
      ).toBeVisible();
      await expect(enginePicker).toBeEnabled();
    } finally {
      await remote.close();
    }
    await page.reload();
    await expect(setup).toBeHidden();
    await expect(page.getByRole("button", { name: "Bot详情" })).toBeVisible();
    await page.getByRole("button", { name: "Bot电脑", exact: true }).click();
    await page.getByRole("button", { name: "电脑设置", exact: true }).click();
    const computer = page.getByRole("region", {
      name: "工作电脑",
      exact: true,
    });
    await expect(
      computer.getByRole("combobox", {
        name: "此 Bot 使用的电脑",
        exact: true,
      }),
    ).toContainText("服务所在电脑");
    await expect(computer.locator(".computer-capabilities")).toContainText(
      "命令",
    );
    await expect(computer.locator(".computer-capabilities")).toContainText(
      "文件",
    );
    await page
      .getByRole("complementary", { name: "Domos的详情" })
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const settings = page.getByRole("main", { name: "设置", exact: true });
    await expect(settings.getByRole("tab")).toHaveText([
      "通用",
      "Providers",
      "Models",
      "Usage",
    ]);
    await settings
      .getByRole("button", { name: "连接设备", exact: true })
      .click();
    const access = page.getByRole("dialog", {
      name: "在其他设备上使用",
      exact: true,
    });
    await expect(
      access.getByRole("heading", { name: "已授权访问", exact: true }),
    ).toBeVisible();
    await access
      .getByRole("button", { name: "生成配对码", exact: true })
      .click();
    await expect(access.locator(".pairing-code")).not.toBeEmpty();
    await access.getByRole("button", { name: "完成", exact: true }).click();
    await expect(access).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath("configured.png") });
    await settings
      .getByRole("button", { name: "返回对话", exact: true })
      .click();
    await page.getByRole("button", { name: "新建 Bot", exact: true }).click();
    const create = page.getByRole("dialog", { name: "新建 Bot", exact: true });
    await expect(create.getByRole("textbox")).toHaveCount(1);
    await expect(create.getByRole("combobox")).toHaveCount(0);
    await create
      .getByRole("textbox", { name: "名字", exact: true })
      .fill("研究伙伴");
    await create.getByRole("button", { name: "创建", exact: true }).click();
    await expect(
      create.getByRole("heading", { name: "Bot 在哪里工作？" }),
    ).toBeVisible();
    await create
      .getByRole("button", { name: "授权并继续", exact: true })
      .click();
    await expect(
      create.getByRole("heading", { name: "由谁处理任务？" }),
    ).toBeVisible();
    const freshEngines = create.getByRole("radiogroup", {
      name: "任务引擎",
      exact: true,
    });
    await expect(
      freshEngines.getByRole("radio", { name: /^Pi/ }),
    ).toBeChecked();
    await expect(
      create.getByRole("button", { name: "开始使用", exact: true }),
    ).toBeDisabled();
    await create.getByRole("button", { name: "返回", exact: true }).click();
    await expect(
      create.getByRole("radio", { name: /^使用服务所在电脑/ }),
    ).toBeChecked();
    await create
      .getByRole("button", { name: "授权并继续", exact: true })
      .click();
    await freshEngines.getByRole("radio", { name: /^Codex/ }).click();
    await expect(
      create.getByRole("button", { name: "开始使用", exact: true }),
    ).toBeEnabled();
    await create.getByRole("button", { name: "开始使用", exact: true }).click();
    await expect(create).toBeHidden();
    const welcome = page.getByRole("region", { name: "入门提示", exact: true });
    await expect(welcome).toBeVisible();
    await welcome
      .getByRole("button", { name: "整理工作文件", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toHaveValue("帮我整理工作文件。先确认目录和整理规则，再开始操作。");
    await welcome
      .getByRole("button", { name: "关闭入门提示", exact: true })
      .click();
    await expect(welcome).toBeHidden();
    expect(installs).toHaveLength(0);
  } finally {
    const exited = once(worker, "exit");
    worker.disconnect();
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
