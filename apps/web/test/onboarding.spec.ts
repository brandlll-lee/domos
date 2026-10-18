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
          "auto",
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

test("first use selects identity, computer and native engine before shared chat", async ({
  page,
  browser,
}, testInfo) => {
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
      setup.getByRole("heading", { name: "认识你的第一个 Bot" }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toBeHidden();
    await capture(page, testInfo, "identity");
    await page.setViewportSize({ width: 390, height: 600 });
    const next = setup.getByRole("button", { name: "继续", exact: true });
    await next.scrollIntoViewIfNeeded();
    await expect(next).toBeInViewport();
    const avatar = await setup.locator(".avatar-editor").boundingBox();
    const change = await setup
      .getByRole("button", { name: "换个形象" })
      .boundingBox();
    expect(change?.x).toBeLessThan((avatar?.x ?? 0) + (avatar?.width ?? 0));
    expect(change?.y).toBeLessThan((avatar?.y ?? 0) + (avatar?.height ?? 0));
    await page.setViewportSize({ width: 1360, height: 900 });
    await setup
      .getByRole("textbox", { name: "职责与长期指令" })
      .fill("帮我整理每周工作计划。");
    await setup.getByRole("button", { name: "继续", exact: true }).click();
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
    await setup.getByRole("button", { name: "返回", exact: true }).click();
    await expect(
      setup.getByRole("textbox", { name: "名字", exact: true }),
    ).toHaveValue("Domos");
    await expect(
      setup.getByRole("textbox", { name: "职责与长期指令" }),
    ).toHaveValue("帮我整理每周工作计划。");
    await setup.getByRole("button", { name: "继续", exact: true }).click();
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
    const installs: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/engines/install"))
        installs.push(request.url());
    });
    await engines.getByRole("radio", { name: /^Codex/ }).click();
    await expect(
      setup.getByRole("button", { name: "登录 Codex", exact: true }),
    ).toBeVisible();
    await capture(page, testInfo, "engine-selection");
    expect(installs).toHaveLength(0);
    await engines.getByRole("radio", { name: /^Pi/ }).click();
    await setup.getByRole("combobox", { name: "此 Bot 的模型" }).click();
    await page.getByRole("option", { name: "Faux Model", exact: true }).click();
    await setup.getByRole("button", { name: "保存模型", exact: true }).click();
    let release = () => {};
    const checking = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/rpc/engines/inspect", async (route) => {
      await checking;
      await route.continue();
    });
    await setup.getByRole("button", { name: "检查连接", exact: true }).click();
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
    await capture(page, testInfo, "engine-setup");
    await setup.getByRole("button", { name: "开始使用", exact: true }).click();
    await expect(setup).toBeHidden();
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
      await page.getByRole("button", { name: "Bot详情", exact: true }).click();
      const engine = page.getByRole("region", {
        name: "任务引擎",
        exact: true,
      });
      await engine
        .getByRole("combobox", { name: "任务引擎", exact: true })
        .click();
      await page.getByRole("option", { name: "Codex", exact: true }).click();
      await capture(page, testInfo, "engine-account");
      await engine
        .getByRole("button", { name: "检查连接", exact: true })
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
    } finally {
      await remote.close();
    }
    await page.reload();
    await expect(setup).toBeHidden();
    await expect(page.getByRole("button", { name: "Bot详情" })).toBeVisible();
    await page.getByRole("button", { name: "Bot电脑", exact: true }).click();
    const computer = page.getByRole("complementary", { name: "Domos的详情" });
    await expect(
      computer.getByText("服务所在电脑", { exact: true }),
    ).toBeVisible();
    await expect(
      computer.getByText("✓ 可执行命令", { exact: true }),
    ).toBeVisible();
    await expect(
      computer.getByText("✓ 可处理文件", { exact: true }),
    ).toBeVisible();
    await computer.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const settings = page.getByRole("main", { name: "设置", exact: true });
    await expect(settings.getByRole("tab")).toHaveText(["通用", "模型"]);
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
  } finally {
    const exited = once(worker, "exit");
    worker.disconnect();
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
